import csv
import json
import logging
import math
import os
import pycountry
import functools

from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs
# Configure Gemini
try:
    import google.generativeai as genai
    # Move API key to environment variable for production security
    api_key = os.environ.get("GEMINI_API_KEY", "[ENCRYPTION_KEY]")
    genai.configure(api_key=api_key)
    gemini_model = genai.GenerativeModel('gemini-2.5-flash')
    GEMINI_ENABLED = True
except Exception as e:
    logging.warning(f"Failed to initialize Gemini: {e}")
    GEMINI_ENABLED = False
    genai = None
    gemini_model = None

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Global ML State
df_historical = []
resilience_scores = []
all_scores_list = []
all_scores_dict = {}
unique_countries = set()
unique_crops = set()

# Fast alias dictionary for specific FAO/non-standard names
# Load Registries
def load_registry(filename):
    path = os.path.join(os.path.dirname(__file__), "data", filename)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

COUNTRY_REGISTRY = load_registry("country_registry.json")
CROP_REGISTRY = load_registry("crop_registry.json")

@functools.lru_cache(maxsize=None)
def get_iso3(country_name: str) -> str | None:
    if not country_name:
        return None
    
    # 1. Check Registry (Highest priority)
    if country_name in COUNTRY_REGISTRY:
        return COUNTRY_REGISTRY[country_name].get("iso3")
    
    # 2. Check if already an Alpha-3 code
    if len(country_name) == 3:
        try:
            res = pycountry.countries.get(alpha_3=country_name.upper())
            if res:
                return res.alpha_3
        except Exception:
            pass

    # 3. Standard Lookup
    try:
        res = pycountry.countries.lookup(country_name)
        return res.alpha_3
    except LookupError:
        # 4. Historic Lookup (e.g. USSR -> SUN)
        try:
            res = pycountry.historic_countries.lookup(country_name)
            return res.alpha_3
        except LookupError:
            return None


DATA_PATH = os.environ.get("DATA_PATH", "")
if not DATA_PATH:
    # Try local data folder first (for Docker)
    local_data = os.path.join(os.path.dirname(__file__), "data", "cleaned_crop_data.csv")
    if os.path.exists(local_data):
        DATA_PATH = local_data
    else:
        # Fallback to sibling haskell-pipeline folder (for local dev)
        DATA_PATH = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "haskell-pipeline",
            "cleaned_crop_data.csv"
        )

# =============================================================================
# Pure Python Machine Learning Implementation
# (Bypassing numpy/scikit-learn due to blocked environment)
# =============================================================================

class OLSYieldModel:
    """
    Dependency-free predictive model implementation.
    Uses manual Ordinary Least Squares (OLS) for multiple linear regression:
    """
    def __init__(self):
        self.models = {}
        self.is_trained = False

    def fit(self, data):
        if not data:
            return
        groups = {}
        for row in data:
            key = (row["Country"], row["Crop"])
            if key not in groups:
                groups[key] = {"X_year": [], "X_temp": [], "y": []}
            groups[key]["X_year"].append(float(row["Year"]))
            groups[key]["X_temp"].append(float(row["TempAnomaly_C"]))
            groups[key]["y"].append(float(row["Yield_tonnes_ha"]))

        for key, g in groups.items():
            n = len(g["y"])
            if n < 5:
                continue
            
            y, x1, x2 = g["y"], g["X_year"], g["X_temp"]
            sum_y, sum_x1, sum_x2 = sum(y), sum(x1), sum(x2)
            sum_x1y = sum(i*j for i,j in zip(x1, y))
            sum_x2y = sum(i*j for i,j in zip(x2, y))
            sum_x1x1 = sum(i*i for i in x1)
            sum_x2x2 = sum(i*i for i in x2)
            sum_x1x2 = sum(i*j for i,j in zip(x1, x2))

            det = (n * (sum_x1x1 * sum_x2x2 - sum_x1x2**2) - 
                   sum_x1 * (sum_x1 * sum_x2x2 - sum_x1x2 * sum_x2) + 
                   sum_x2 * (sum_x1 * sum_x1x2 - sum_x1x1 * sum_x2))

            if abs(det) < 1e-9:
                continue

            b0 = (sum_y * (sum_x1x1 * sum_x2x2 - sum_x1x2**2) - 
                  sum_x1 * (sum_x1y * sum_x2x2 - sum_x1x2 * sum_x2y) + 
                  sum_x2 * (sum_x1y * sum_x1x2 - sum_x1x1 * sum_x2y)) / det
            b1 = (n * (sum_x1y * sum_x2x2 - sum_x1x2 * sum_x2y) - 
                  sum_y * (sum_x1 * sum_x2x2 - sum_x1x2 * sum_x2) + 
                  sum_x2 * (sum_x1 * sum_x2y - sum_x1y * sum_x2)) / det
            b2 = (n * (sum_x1x1 * sum_x2y - sum_x1x2 * sum_x1y) - 
                  sum_x1 * (sum_x1 * sum_x2y - sum_x1y * sum_x2) + 
                  sum_y * (sum_x1 * sum_x1x2 - sum_x1x1 * sum_x2)) / det

            residuals_sq = []
            for i in range(n):
                pred = b0 + b1 * x1[i] + b2 * x2[i]
                residuals_sq.append((y[i] - pred)**2)
            std_err = math.sqrt(sum(residuals_sq) / max(1, n - 3))

            self.models[key] = {"intercept": b0, "coef_year": b1, "coef_temp": b2, "std": std_err}

        self.is_trained = True
        logging.info(f"Trained {len(self.models)} independent micro-models (OLS).")

    def predict(self, country, crop, year, temp_anomaly):
        key = (country, crop)
        if not self.is_trained or key not in self.models:
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
        m = self.models[key]
        pred = m["intercept"] + m["coef_year"] * year + m["coef_temp"] * temp_anomaly
        std = max(0.1, m["std"])
        extrapolation_penalty = max(0, year - 2024) * 0.02 * pred
        std += extrapolation_penalty
        return {
            "predicted_yield": max(0.0, round(pred, 3)),
            "confidence_low": max(0.0, round(pred - 1.96 * std, 3)),
            "confidence_high": round(pred + 1.96 * std, 3),
        }


class XGBoostYieldModel:
    def __init__(self):
        self.models = {}
        self.training_data = {}
        self.is_trained = False

    def fit(self, data):
        """
        Stores the data grouped by country/crop but delays actual XGBoost 
        training until the model is requested (Lazy Evaluation) to save startup time.
        """
        for row in data:
            key = (row["Country"], row["Crop"])
            if key not in self.training_data: 
                self.training_data[key] = {"X": [], "y": []}
            self.training_data[key]["X"].append([float(row["Year"]), float(row["TempAnomaly_C"])])
            self.training_data[key]["y"].append(float(row["Yield_tonnes_ha"]))

        self.is_trained = True
        logging.info(f"Registered {len(self.training_data)} potential XGBoost models for Lazy Training.")

    def _train_single_model(self, key):
        if key not in self.training_data or key in self.models:
            return

        g = self.training_data[key]
        if len(g["y"]) < 5: 
            self.models[key] = None
            return

        import xgboost as xgb
        # Quick, shallow model to ensure fast on-the-fly training
        model = xgb.XGBRegressor(n_estimators=30, max_depth=3, learning_rate=0.1, objective='reg:squarederror')
        model.fit(g["X"], g["y"])
        preds = model.predict(g["X"])
        residuals_sq = [(y - p)**2 for y, p in zip(g["y"], preds)]
        std_err = math.sqrt(sum(residuals_sq) / max(1, len(g["y"]) - 1))
        
        self.models[key] = {"model": model, "std": std_err}
        logging.info(f"Lazily trained XGBoost model for {key[0]} - {key[1]}")

    def predict(self, country, crop, year, temp_anomaly):
        key = (country, crop)
        
        # Lazy load the model if not trained yet
        if self.is_trained and key not in self.models:
            self._train_single_model(key)

        if not self.is_trained or key not in self.models or self.models[key] is None:
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
            
        m = self.models[key]
        pred = float(m["model"].predict([[year, temp_anomaly]])[0])
        std = max(0.1, m["std"])
        extrapolation_penalty = max(0, year - 2024) * 0.03 * pred
        std += extrapolation_penalty
        return {
            "predicted_yield": max(0.0, round(pred, 3)),
            "confidence_low": max(0.0, round(pred - 1.96 * std, 3)),
            "confidence_high": round(pred + 1.96 * std, 3),
        }

class SARIMAXYieldModel:
    def __init__(self):
        self.models = {}
        self.training_data = {}
        self.is_trained = False

    def fit(self, data):
        """
        Stores the data grouped by country/crop. Actual SARIMAX training is delayed 
        until prediction (Lazy Evaluation) because time-series fitting is slow.
        """
        import pandas as pd
        for row in data:
            key = (row["Country"], row["Crop"])
            if key not in self.training_data: 
                self.training_data[key] = {"Year": [], "TempAnomaly_C": [], "Yield_tonnes_ha": []}
            self.training_data[key]["Year"].append(int(row["Year"]))
            self.training_data[key]["TempAnomaly_C"].append(float(row["TempAnomaly_C"]))
            self.training_data[key]["Yield_tonnes_ha"].append(float(row["Yield_tonnes_ha"]))

        # Convert to sorted dataframes for easier time-series handling
        for key in self.training_data:
            df = pd.DataFrame(self.training_data[key])
            df = df.sort_values("Year").set_index("Year")
            self.training_data[key] = df

        self.is_trained = True
        logging.info(f"Registered {len(self.training_data)} potential SARIMAX models for Lazy Training.")

    def _train_single_model(self, key):
        if key not in self.training_data or key in self.models:
            return

        df = self.training_data[key]
        if len(df) < 10: 
            self.models[key] = None # Not enough data for reliable time-series
            return

        from statsmodels.tsa.statespace.sarimax import SARIMAX
        try:
            # Endogenous variable: Yield. Exogenous variable: Temperature Anomaly
            # We use a simple ARIMA(1,1,1) order as a general robust baseline for agricultural data
            model = SARIMAX(df['Yield_tonnes_ha'], exog=df[['TempAnomaly_C']], order=(1, 1, 1), enforce_stationarity=False, enforce_invertibility=False)
            results = model.fit(disp=False)
            
            # Rough estimate of standard error from the residuals
            std_err = results.resid.std()
            self.models[key] = {"model": results, "last_year": df.index.max(), "std": std_err}
            logging.info(f"Lazily trained SARIMAX model for {key[0]} - {key[1]}")
        except Exception as e:
            logging.warning(f"Failed to train SARIMAX for {key}: {e}")
            self.models[key] = None

    def predict(self, country, crop, year, temp_anomaly):
        key = (country, crop)
        
        if self.is_trained and key not in self.models:
            self._train_single_model(key)

        if not self.is_trained or key not in self.models or self.models[key] is None:
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
            
        m = self.models[key]
        results = m["model"]
        last_year = m["last_year"]
        
        # If predicting past years, we can't easily use out-of-sample forecasting with SARIMAX gracefully here without a wider refactor. 
        # For simplicity in this demo, if they ask for a past year, we just return 0 to trigger the OLS fallback.
        if year <= last_year:
             return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
             
        steps = year - last_year
        
        import pandas as pd
        # Provide the exogenous variable (temperature) for the forecasted steps
        # We assume the user-provided temp_anomaly holds constant for the intervening gap years for the sake of the API
        exog_future = pd.DataFrame({'TempAnomaly_C': [temp_anomaly] * steps}, index=range(last_year + 1, year + 1))
        
        try:
            forecast = results.get_forecast(steps=steps, exog=exog_future)
            # Get the prediction for the target year (the last step)
            pred = forecast.predicted_mean.iloc[-1]
            ci = forecast.conf_int(alpha=0.05).iloc[-1]
            
            return {
                "predicted_yield": max(0.0, round(float(pred), 3)),
                "confidence_low": max(0.0, round(float(ci.iloc[0]), 3)),
                "confidence_high": round(float(ci.iloc[1]), 3),
            }
        except Exception as e:
            logging.error(f"SARIMAX Prediction failed: {e}")
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}


class ProphetYieldModel:
    def __init__(self):
        self.models = {}
        self.training_data = {}
        self.is_trained = False

    def fit(self, data):
        """
        Stores data for Lazy Evaluation. Prophet is very fast, but still best 
        to only train on demand for specific crops.
        """
        import pandas as pd
        for row in data:
            key = (row["Country"], row["Crop"])
            if key not in self.training_data: 
                self.training_data[key] = {"ds": [], "y": [], "TempAnomaly_C": []}
            # Prophet requires 'ds' (datestamp) and 'y' (target) columns
            self.training_data[key]["ds"].append(f"{int(row['Year'])}-01-01") 
            self.training_data[key]["y"].append(float(row["Yield_tonnes_ha"]))
            self.training_data[key]["TempAnomaly_C"].append(float(row["TempAnomaly_C"]))
            
        for key in self.training_data:
            df = pd.DataFrame(self.training_data[key])
            self.training_data[key] = df

        self.is_trained = True
        logging.info(f"Registered {len(self.training_data)} potential Prophet models for Lazy Training.")

    def _train_single_model(self, key):
        if key not in self.training_data or key in self.models:
            return

        df = self.training_data[key]
        if len(df) < 5: 
            self.models[key] = None
            return

        from prophet import Prophet
        try:
            # We add TempAnomaly as an extra regressor
            model = Prophet(yearly_seasonality=False, weekly_seasonality=False, daily_seasonality=False)
            model.add_regressor('TempAnomaly_C')
            model.fit(df)
            
            self.models[key] = {"model": model, "last_year": int(df['ds'].max()[:4])}
            logging.info(f"Lazily trained Prophet model for {key[0]} - {key[1]}")
        except Exception as e:
            logging.warning(f"Failed to train Prophet for {key}: {e}")
            self.models[key] = None

    def predict(self, country, crop, year, temp_anomaly):
        key = (country, crop)
        
        if self.is_trained and key not in self.models:
            self._train_single_model(key)

        if not self.is_trained or key not in self.models or self.models[key] is None:
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
            
        m = self.models[key]
        model = m["model"]
        last_year = m["last_year"]
        
        if year <= last_year:
             return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}
             
        import pandas as pd
        future_dates = [f"{y}-01-01" for y in range(last_year + 1, year + 1)]
        future = pd.DataFrame({'ds': pd.to_datetime(future_dates)})
        # Prophet requires the regressor values for the future dates
        future['TempAnomaly_C'] = temp_anomaly 
        
        try:
            forecast = model.predict(future)
            # Get the prediction and intervals for the target year (the last row)
            target_row = forecast.iloc[-1]
            pred = target_row['yhat']
            ci_low = target_row['yhat_lower']
            ci_high = target_row['yhat_upper']
            
            return {
                "predicted_yield": max(0.0, round(float(pred), 3)),
                "confidence_low": max(0.0, round(float(ci_low), 3)),
                "confidence_high": round(float(ci_high), 3),
            }
        except Exception as e:
            logging.error(f"Prophet Prediction failed: {e}")
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}

class OmniStackingModel:
    def __init__(self, factory):
        self.factory = factory
        self.is_trained = False

    def fit(self, data):
        # We rely on dynamic consensus during predict() based on lazy evaluation of base models
        self.is_trained = True

    def predict(self, country, crop, year, temp_anomaly):
        base_models = [m for m in self.factory.get_available_models() if m != 'omni_ensemble']
        
        predictions = {}
        for m in base_models:
            # Bypass factory recursion loop by calling the strategy directly
            res = self.factory.strategies[m].predict(country, crop, year, temp_anomaly)
            if res.get("predicted_yield", 0) > 0.0:
                 ci_spread = res["confidence_high"] - res["confidence_low"]
                 
                 inherent_trust = 1.0
                 if m == 'xgboost':
                     inherent_trust = 1.2
                 if m == 'prophet':
                     inherent_trust = 1.0  # Removed artificial boost for prophet as it already has tight CIs
                 if m == 'ols':
                     inherent_trust = 0.8

                 # Prevent extreme weighting from very narrow CIs by setting a floor
                 if ci_spread > 0:
                     weight = inherent_trust / max(1.0, ci_spread)
                 else:
                     weight = 0.5 * inherent_trust 
                 
                 predictions[m] = {
                     "yield": res["predicted_yield"],
                     "ci_low": res["confidence_low"],
                     "ci_high": res["confidence_high"],
                     "weight": weight
                 }
                 
        if not predictions:
            return {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0, "weights": {}}
            
        total_weight = sum(p["weight"] for p in predictions.values())
        
        omni_yield = 0.0
        omni_ci_low = 0.0
        omni_ci_high = 0.0
        normalized_weights = {}
        
        for m, p in predictions.items():
            norm_w = p["weight"] / total_weight
            normalized_weights[m] = round(norm_w * 100, 1) 
            
            omni_yield += p["yield"] * norm_w
            omni_ci_low += p["ci_low"] * norm_w
            omni_ci_high += p["ci_high"] * norm_w
            
        return {
            "predicted_yield": round(omni_yield, 3),
            "confidence_low": round(omni_ci_low, 3),
            "confidence_high": round(omni_ci_high, 3),
            "weights": normalized_weights
        }

class ModelFactory:
    def __init__(self):
        self.strategies = {}
        self.is_trained = False

    def fit(self, data):
        self.strategies['ols'] = OLSYieldModel()
        self.strategies['ols'].fit(data)

        try:
            import xgboost  # noqa: F401 - availability probe
            self.strategies['xgboost'] = XGBoostYieldModel()
            self.strategies['xgboost'].fit(data)
        except ImportError:
            logging.warning("XGBoost not installed. Skipping XGBoost model.")
            
        try:
            import statsmodels  # noqa: F401 - availability probe
            import pandas  # noqa: F401 - availability probe
            self.strategies['arima/sarima'] = SARIMAXYieldModel()
            self.strategies['arima/sarima'].fit(data)
        except ImportError:
            logging.warning("Statsmodels or Pandas not installed. Skipping SARIMAX model.")

        try:
            import prophet  # noqa: F401 - availability probe
            import pandas  # noqa: F401 - availability probe
            self.strategies['prophet'] = ProphetYieldModel()
            self.strategies['prophet'].fit(data)
        except ImportError:
            logging.warning("Prophet not installed. Skipping Prophet model.")

        # Initialize the overarching Stacking Ensemble
        self.strategies['omni_ensemble'] = OmniStackingModel(self)
        self.strategies['omni_ensemble'].fit(data)

        self.is_trained = True

    def predict(self, model_type, country, crop, year, temp_anomaly):
        if model_type not in self.strategies:
            model_type = 'ols'  # Fallback

        # Assuming the specific strategy has a predict method that returns a dict
        result = self.strategies[model_type].predict(country, crop, year, temp_anomaly)
        
        # In case the specific model failed to train on that crop
        if result.get("predicted_yield", 0) == 0.0 and model_type != 'ols':
             result = self.strategies['ols'].predict(country, crop, year, temp_anomaly)
             
        return result
        
    def get_available_models(self):
        return list(self.strategies.keys())

# Initialize Model Instance
model = ModelFactory()

# =============================================================================
# Startup Data Ingestion & Scoring
# =============================================================================

def load_and_train():
    global df_historical, resilience_scores, all_scores_dict, unique_countries, unique_crops, all_scores_list

    logging.info(f"Loading cleaned data from {DATA_PATH}...")
    if not os.path.exists(DATA_PATH):
        logging.error("[ERROR] Data file not found. Ensure Phase 1 ran successfully.")
        return

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            df_historical.append({
                "Year": int(row["Year"]),
                "Country": row["Country"],
                "Crop": row["Crop"],
                "Yield_tonnes_ha": float(row["Yield_tonnes_ha"]),
                "TempAnomaly_C": float(row["TempAnomaly_C"]),
                "RollingAvg_5yr": float(row["RollingAvg_5yr"])
            })
            unique_countries.add(row["Country"])
            unique_crops.add(row["Crop"])

    if df_historical:
        logging.info(f"Dataset shape: {len(df_historical)} rows.")
        
        # 1. Train Model (Pure Python Implementation)
        logging.info("Training OLS Regression models...")
        model.fit(df_historical)

        # 2. Compute Pearson Correlation Statistics (Climate Stability Analysis)
        logging.info("Computing Pearson Correlation Statistics...")
        groups = {}
        for row in df_historical:
            key = (row["Country"], row["Crop"])
            if key not in groups:
                groups[key] = {"Yield": [], "Temp": [], "Years": [], "RollingAvg": []}
            groups[key]["Yield"].append(row["Yield_tonnes_ha"])
            groups[key]["Temp"].append(row["TempAnomaly_C"])
            groups[key]["Years"].append(row["Year"])
            groups[key]["RollingAvg"].append(row["RollingAvg_5yr"])

        scores_list = []
        for (country, crop), data in groups.items():
            n = len(data["Yield"])
            if n < 5:
                continue
                
            y_mean = sum(data["Yield"]) / n
            t_mean = sum(data["Temp"]) / n
            
            # Detrend yield to isolate climate shocks
            yield_shocks = [y - r for y, r in zip(data["Yield"], data["RollingAvg"])]
            ys_mean = sum(yield_shocks) / n
            
            numerator = sum((t - t_mean) * (ys - ys_mean) for t, ys in zip(data["Temp"], yield_shocks))
            den_t = sum((t - t_mean)**2 for t in data["Temp"])
            den_y = sum((ys - ys_mean)**2 for ys in yield_shocks)
            
            if den_t == 0 or den_y == 0:
                corr = 0.0
            else:
                corr = numerator / math.sqrt(den_t * den_y)

            # Map to 1-10 Resilience Score
            corr_clamped = max(-1.0, min(1.0, corr))
            score = 5.5 + (corr_clamped * 4.5)
            score = max(1.0, min(10.0, score))

            # Compute yield trend (OLS slope)
            years = data["Years"]
            yields = data["Yield"]
            year_mean = sum(years) / n
            slope_num = sum((yr - year_mean) * (yd - y_mean) for yr, yd in zip(years, yields))
            slope_den = sum((yr - year_mean) ** 2 for yr in years)
            trend_slope = slope_num / slope_den if slope_den != 0 else 0.0
            trend = "increasing" if trend_slope > 0.005 else ("decreasing" if trend_slope < -0.005 else "stable")

            scores_list.append({
                "country": country,
                "crop": crop,
                "resilience_score": round(score, 1),
                "correlation": round(corr_clamped, 3),
                "trend": trend,
                "avg_yield": round(y_mean, 2),
                "data_points": n
            })
            all_scores_dict[(country, crop)] = scores_list[-1]

        # Store all valid scores for comprehensive map data
        all_scores_list = sorted(scores_list, key=lambda x: (x["resilience_score"], x["data_points"], x["avg_yield"]), reverse=True)

        # Strict Leaderboard filter (Top 10 chart only)
        filtered_for_leaderboard = [s for s in scores_list if s["avg_yield"] >= 1.0 and s["data_points"] >= 30]
        resilience_scores = sorted(filtered_for_leaderboard, key=lambda x: (x["resilience_score"], x["data_points"], x["avg_yield"]), reverse=True)

        if resilience_scores:
            logging.info(f"Leading Climate-Stable Region: {resilience_scores[0]['country']} - {resilience_scores[0]['crop']}")

        # Startup Coverage Assertion
        unique_isos = set(iso for s in all_scores_list if (iso := get_iso3(s["country"])))
        coverage_pct = (len(unique_isos) / 245) * 100 # Baseline based on total FAO countries seen in audit
        logging.info(f"[Startup] ISO Coverage: {len(unique_isos)} countries ({coverage_pct:.1f}%)")
        
        if coverage_pct < 50:
             logging.error("CRITICAL: ISO Coverage dropped below safety baseline (50%). Check registries!")
             # In production, we might sys.exit(1), but for dev we just alert loudly.


# =============================================================================
# HTTP API Server (Standard Library)
# =============================================================================

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class ClimateAPIHandler(BaseHTTPRequestHandler):
    def send_json_response(self, data, status_code=200):
        try:
            self.send_response(status_code)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-type')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass 
        
    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-type')
            self.end_headers()
        except OSError:
            pass

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query_params = parse_qs(parsed_path.query)

        if path == "/":
            self.send_json_response({
                "message": "Project Omni — Climate Resilience ML API",
                "model": "Zero-Dependency OLS Regression",
                "endpoints": ["/api/data", "/api/resilience", "/api/predict", "/api/metadata"]
            })

        elif path == "/api/metadata":
            years = [r["Year"] for r in df_historical] if df_historical else []
            country_crop_map = {}
            if df_historical:
                for row in df_historical:
                    c = row["Country"]
                    cr = row["Crop"]
                    if c not in country_crop_map:
                        country_crop_map[c] = set()
                    country_crop_map[c].add(cr)
                    
            self.send_json_response({
                "countries": sorted(list(unique_countries)),
                "crops": sorted(list(unique_crops)),
                "country_crop_map": {k: sorted(list(v)) for k, v in country_crop_map.items()},
                "year_range": [min(years), max(years)] if years else [],
                "total_records": len(df_historical),
                "available_models": model.get_available_models(),
                "model_trained": model.is_trained
            })

        elif path == "/api/data":
            country_filter = query_params.get("country", [None])[0]
            crop_filter = query_params.get("crop", [None])[0]
            
            if country_filter or crop_filter:
                filtered = [
                    row for row in df_historical 
                    if (not country_filter or row["Country"] == country_filter) and 
                       (not crop_filter or row["Crop"] == crop_filter)
                ]
                self.send_json_response(filtered)
            else:
                # Still support full dump if needed, but consider limiting
                self.send_json_response(df_historical[:1000]) # Limit return if no filters provided

        elif path == "/api/predict":
            if not model.is_trained:
                self.send_json_response({"error": "Model not trained."}, 503)
                return
            try:
                country = query_params.get("country", [""])[0]
                crop = query_params.get("crop", [""])[0]
                year = int(query_params.get("year", [0])[0])
                temp_increase = float(query_params.get("temp_increase", [0.0])[0])
                model_type = query_params.get("model_type", ["ols"])[0]
                
                if country not in unique_countries or crop not in unique_crops:
                    self.send_json_response({"error": "Unknown country or crop"}, 400)
                    return

                result = model.predict(model_type, country, crop, year, temp_increase)
                if "error" in result:
                    self.send_json_response(result, 400)
                    return

                response_data = {
                    "country": country,
                    "iso_a3": get_iso3(country), # Add ISO A3 code
                    "crop": crop,
                    "year": year,
                    "temp_increase_c": temp_increase,
                    "predicted_yield_tonnes_ha": result["predicted_yield"],
                    "confidence_low": result["confidence_low"],
                    "confidence_high": result["confidence_high"],
                    "model_type": model_type
                }
                
                if "weights" in result:
                    response_data["weights"] = result["weights"]
                    
                self.send_json_response(response_data)
            except (ValueError, IndexError):
                self.send_json_response({"error": "Invalid parameters"}, 400)

        elif path == "/api/debug/coverage":
            # Diagnostic endpoint to provably trace where countries are dropped
            stats = {
                "total_cleaned_tuples": len(all_scores_list),
                "unique_countries": len(set(s["country"] for s in all_scores_list)),
                "iso_mapped": sum(1 for s in all_scores_list if get_iso3(s["country"])),
                "unmapped": sorted(list(set(s["country"] for s in all_scores_list if not get_iso3(s["country"]))))
            }
            self.send_json_response(stats)

        elif path == "/api/resilience":
            try:
                # DEFAULT LIMIT: 10 for global leaderboard, 2000 if crop is selected for map
                crop_filter = query_params.get("crop", [None])[0]
                default_limit = 2000 if crop_filter else 10
                limit = int(query_params.get("limit", [default_limit])[0])
                country_filter = query_params.get("country", [None])[0]
            except ValueError:
                limit = 10
                crop_filter = None
                country_filter = None
            
            if country_filter and crop_filter:
                # Return specific score for a country and crop
                specific = all_scores_dict.get((country_filter, crop_filter))
                self.send_json_response({"specific_score": specific})
                return
            
            # Use dense data for the map (crop requested), strict data for the leaderboard (no crop)
            if crop_filter:
                data_to_return = [s for s in all_scores_list if s["crop"] == crop_filter]
            else:
                data_to_return = resilience_scores
                
            # Ensure iso_a3 and metadata are present
            enriched_data = []
            seen_isos = set()
            
            for s in data_to_return:
                iso = s.get("iso_a3") or get_iso3(s["country"])
                if not iso:
                    s["exclusion_reason"] = "no_iso"
                    continue
                
                s["iso_a3"] = iso
                
                # Deduplicate by ISO for the Map view (avoid overlapping dots/colors)
                if crop_filter:
                    if iso in seen_isos:
                        continue
                    seen_isos.add(iso)
                
                enriched_data.append(s)

            response_data = {"top_resilient": enriched_data[:limit]}
            
            # Boundary Logging
            logging.info(f"[API] /api/resilience: crop={crop_filter}, limit={limit}, returned={len(enriched_data[:limit])}")
            
            self.send_json_response(response_data)

        elif path == "/api/timeseries-map":
            crop_filter = query_params.get("crop", [""])[0]
            if not crop_filter:
                self.send_json_response({"error": "crop parameter required"}, 400)
                return
            
            timeseries_data = {}
            for row in df_historical:
                if row["Crop"] == crop_filter:
                    country = row["Country"]
                    if country not in timeseries_data:
                        timeseries_data[country] = {}
                    timeseries_data[country][str(row["Year"])] = row["Yield_tonnes_ha"]
            
            self.send_json_response({"yields": timeseries_data})

        else:
            self.send_json_response({"error": "Not found"}, 404)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == "/api/simulate_market":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                country = data.get("country", "Unknown")
                crop = data.get("crop", "Unknown")
                temp_anomaly = data.get("temperature_anomaly", 0.0)
                predictions = data.get("predictions", {})

                if GEMINI_ENABLED:
                    prompt = f"""
                    You are an expert agricultural economist and geopolitical analyst acting as a "Virtual Farmer Market Simulation" engine.
                    
                    Scenario:
                    - Country: {country}
                    - Crop: {crop}
                    - Climate Shock: A temperature anomaly of {temp_anomaly}°C is projected.
                    - Ensemble Prediction Data: {json.dumps(predictions)}
                    
                    Analyze this data and simulate how real farmers and global markets will react.
                    Output ONLY a valid JSON object with the following exact keys (no markdown formatting, no introduction):
                    - "Adaptation_Strategy": A 1-2 sentence description of what local farmers and policymakers will physically do (e.g., switch crops, invest in genetic mod, migrate).
                    - "Market_Disruption_Level": A single string value: "Low", "Medium", "High", or "Critical".
                    - "Economic_Impact": A concise 2-sentence paragraph describing the macroeconomic consequences (price spikes, supply chain failures, etc.) over the next 5 years.
                    """
                    
                    response = gemini_model.generate_content(prompt)
                    response_text = response.text.strip()
                    # Strip markdown json block if present
                    if response_text.startswith("```json"):
                        response_text = response_text.replace("```json", "", 1)
                    if response_text.endswith("```"):
                        response_text = response_text[:-3]
                        
                    parsed_sim = json.loads(response_text)
                    self.send_json_response(parsed_sim)
                else:
                    # Fallback Ruleset
                    self.send_json_response({
                        "Adaptation_Strategy": f"Farmers in {country} implement emergency drought-resistant {crop} strains and ration water supplies.",
                        "Market_Disruption_Level": "Medium" if temp_anomaly < 2.0 else "High",
                        "Economic_Impact": f"Global prices for {crop} destabilize, causing localized inflation in {country}. Supply chain partners seek alternative imports within 24 months."
                    })
                    
            except Exception as e:
                logging.error(f"Failed to simulate market: {e}")
                self.send_json_response({"error": str(e)}, 500)
        else:
            self.send_json_response({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        # logging.info(f"[HTTP] {args[0]}")
        pass

def run_server():
    # Use Render's PORT environment variable or default to 8000
    port = int(os.environ.get("PORT", 8000))
    # Listen on all interfaces (0.0.0.0) for cloud deployment
    server_address = ('0.0.0.0', port)
    httpd = ThreadingHTTPServer(server_address, ClimateAPIHandler)
    logging.info(f"🚀 Climate Resilience API (No-Dep) running on port {port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()

if __name__ == "__main__":
    import threading
    # Launch heavy data loading/training in a background thread
    # This ensures the HTTP server starts immediately, avoiding Render's port detection timeout
    threading.Thread(target=load_and_train, daemon=True).start()
    run_server()
