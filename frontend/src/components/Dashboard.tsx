import React, { useState, useEffect } from "react";
import {
  fetchHistoricalData,
  fetchResilienceScores,
  fetchPrediction,
  CropData,
  ResilienceScore,
  PredictionResult,
} from "../api";

/**
 * Dashboard.tsx
 * 
 * Example functional React component demonstrating how to use `api.ts` to
 * fetch and display the Data Pipeline (Phase 1) and Python API (Phase 2) data.
 */
export default function Dashboard() {
  // --- Component State ---

  // Phase 1 Historical Data
  const [historicalData, setHistoricalData] = useState<CropData[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  
  // Phase 2 Resilience Scores
  const [resilienceScores, setResilienceScores] = useState<ResilienceScore[]>([]);
  const [loadingScores, setLoadingScores] = useState(true);

  // Phase 2 Prediction Scenario
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [predictError, setPredictError] = useState<string | null>(null);

  // Form inputs for the prediction module
  const [targetCountry, setTargetCountry] = useState("India");
  const [targetCrop, setTargetCrop] = useState("Wheat");
  const [targetYear, setTargetYear] = useState(2030);
  const [tempAnomaly, setTempAnomaly] = useState(1.5);

  // --- Initial Data Load (Component Mount) ---

  useEffect(() => {
    // 1. Fetch historical raw data
    fetchHistoricalData()
      .then((data) => {
        setHistoricalData(data);
        setLoadingHistory(false);
      })
      .catch((error) => {
        console.error("Failed to load history:", error);
        setLoadingHistory(false);
      });

    // 2. Fetch the pre-computed Climate Resilience scores
    fetchResilienceScores(5)
      .then((scores) => {
        setResilienceScores(scores);
        setLoadingScores(false);
      })
      .catch((error) => {
        console.error("Failed to load resilience scores:", error);
        setLoadingScores(false);
      });
  }, []); // The empty dependency array ensures this runs exactly once on mount


  // --- Scenario Handler ---

  const handleRunScenario = async (e: React.FormEvent) => {
    e.preventDefault(); // Prevent page reload on form submit
    setPredicting(true);
    setPredictError(null);

    try {
      // Call the Python ML Backend to forecast the yield
      const result = await fetchPrediction(
        targetCountry,
        targetCrop,
        targetYear,
        tempAnomaly
      );
      setPrediction(result);
    } catch (error: any) {
      setPredictError(error.message || "Failed to predict yield.");
    } finally {
      setPredicting(false);
    }
  };


  // --- Render UI ---

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Recursive Analytics Dashboard: Climate Resilience</h1>
      
      {/* 
        This is where you would mount a robust charting library like
        Recharts or Chart.js, passing `historicalData` as the payload.
      */}
      <section style={styles.section}>
        <h2>Historical Crop Yield vs Temp Anomaly (Phase 1 Data)</h2>
        {loadingHistory ? (
          <p>Loading millions of data points...</p>
        ) : (
          <p>Successfully loaded {historicalData.length} data points from Haskell ingestion engine.</p>
        )}
      </section>

      {/* 
        Displays the top resilient crops calculated in Phase 2
      */}
      <section style={styles.section}>
        <h2>Top Climate Resilient Crops</h2>
        {loadingScores ? (
          <p>Calculating Pearson Correlates...</p>
        ) : (
          <ul>
            {resilienceScores.map((score, index) => (
              <li key={index}>
                <strong>{score.country} / {score.crop}:</strong>{" "}
                Score: {score.resilience_score}/10{" "}
                <span style={{ color: "#666", fontSize: "0.9em" }}>
                  (Correlation: {score.correlation})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 
        Interactive Machine Learning Form pushing params to Phase 2 Backend
      */}
      <section style={{ ...styles.section, backgroundColor: "#f9f9f9" }}>
        <h2>Simulate Climate Scenarios</h2>
        <form onSubmit={handleRunScenario} style={styles.form}>
          <label> Country
            <select value={targetCountry} onChange={e => setTargetCountry(e.target.value)}>
              <option value="India">India</option>
              <option value="USA">USA</option>
              <option value="Brazil">Brazil</option>
              {/* You can populate this dynamically using Set(historicalData.map(d=>d.Country)) */}
            </select>
          </label>
          <label> Crop
            <select value={targetCrop} onChange={e => setTargetCrop(e.target.value)}>
              <option value="Wheat">Wheat</option>
              <option value="Rice">Rice</option>
              <option value="Maize">Maize</option>
            </select>
          </label>
          <label> Target Year
            <input type="number" value={targetYear} onChange={e => setTargetYear(Number(e.target.value))} />
          </label>
          <label> Temp Anomaly Projected (+°C)
            <input type="number" step="0.1" value={tempAnomaly} onChange={e => setTempAnomaly(Number(e.target.value))} />
          </label>
          <button type="submit" disabled={predicting}>
            {predicting ? "Running Model..." : "Forecast Yield"}
          </button>
        </form>

        {predictError && <p style={{ color: "red" }}>{predictError}</p>}
        
        {prediction && !predicting && (
          <div style={styles.resultBox}>
            <h3>Prediction Result</h3>
            <p>
              In {prediction.year}, under a temperature increase of <strong>+{prediction.temp_increase_c}°C</strong>, 
              the mocked predictive model forecasts that {prediction.country}&apos;s {prediction.crop} yield will be:
            </p>
            <h1 style={{ color: "#2E8B57" }}>{prediction.predicted_yield_tonnes_ha} tonnes/ha</h1>
          </div>
        )}
      </section>
    </div>
  );
}

// Simple inline styles to keep the example clean
const styles = {
  section: {
    marginBottom: "2rem",
    padding: "1rem",
    border: "1px solid #ddd",
    borderRadius: "8px",
  },
  form: {
    display: "flex",
    gap: "1rem",
    alignItems: "flex-end",
    marginBottom: "1rem",
  },
  resultBox: {
    marginTop: "1rem",
    padding: "1rem",
    backgroundColor: "#e8f5e9",
    borderLeft: "4px solid #4caf50",
  }
};
