"use client";

import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense, useRef } from "react";
import { motion } from "framer-motion";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Cell,
  ErrorBar,
  Legend as RechartsLegend,
  RadarChart,
  Radar,
  PolarAngleAxis,
  PolarRadiusAxis,
  PolarGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  LineChart,
  Line,
} from "recharts";
import { Sprout, ThermometerSun, ChevronDown, MapPin, Globe, BarChart3, Loader2, TrendingUp, Crosshair, Download, FileText, Box, Bot, Activity, AlertTriangle } from "lucide-react";
import {
  fetchHistoricalData,
  fetchResilienceScores,
  fetchSpecificScore,
  fetchMetadata,
  fetchPrediction,
  fetchComparativePredictions,
  fetchTimeseriesMap,
  fetchMarketSimulation,
  type CropData,
  type ResilienceScore,
  type MetadataResponse,
  type PredictionResult,
  type TimeseriesData,
  type MarketSimulationResult,
} from "../api";

import Timeline from "./Timeline";

// Lazy load Leaflet map (it requires window/document)
const GlobeView = lazy(() => import("./GlobeView"));

// --- Animation Variants ---
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

// --- Custom Tooltip ---
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/90 backdrop-blur-xl border border-emerald-500/10 shadow-[0_20px_50px_rgba(0,0,0,0.1)] rounded-2xl p-5 text-slate-800 min-w-[180px]">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
          <p className="font-bold text-slate-500 text-xs uppercase tracking-widest">Growth Year</p>
          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-md text-xs font-black tracking-tight">{label}</span>
        </div>
        <div className="space-y-3">
          <div className="flex flex-col">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Agricultural Yield</p>
            <p className="text-emerald-600 font-black text-xl tracking-tighter">
              {payload[0]?.value?.toFixed(2)} <span className="text-[10px] font-bold text-emerald-400">t/ha</span>
            </p>
          </div>
          {payload[1] && (
            <div className="flex flex-col pt-2 border-t border-slate-50">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Temp Anomaly</p>
              <p className="text-amber-500 font-black text-xl tracking-tighter">
                +{payload[1]?.value?.toFixed(2)}<span className="text-[10px] font-bold text-amber-400">°C</span>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};

// --- Custom XAxis Tick for long labels ---
const CustomXAxisTick = ({ x, y, payload }: any) => {
  const label = payload.value.replace('\n', ' • ');
  const truncatedLabel = label.length > 20 ? label.substring(0, 18) + "..." : label;
  
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="end"
        fill="#64748b"
        fontSize={10}
        fontWeight={500}
        transform="rotate(-35)"
      >
        {truncatedLabel}
      </text>
    </g>
  );
};

// --- Custom Tooltip for Comparative Chart ---
const ComparativeTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 shadow-[0_25px_60px_rgba(0,0,0,0.3)] rounded-2xl p-5 text-white min-w-[220px]">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.3)]" style={{ backgroundColor: data.color || '#10b981' }} />
            <p className="font-black text-xs uppercase tracking-[0.1em] text-slate-400">Model: {label}</p>
          </div>
          <Bot className="w-3.5 h-3.5 text-slate-500" />
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Predicted Yield</p>
            <p className="text-2xl font-black tracking-tighter text-white">
              {data.y.toFixed(2)} <span className="text-xs font-bold text-slate-500">t/ha</span>
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/30">
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.1em] mb-2">95% Confidence Interval</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-60"
                  style={{ width: '100%' }}
                />
              </div>
              <span className="font-mono text-[10px] text-emerald-400 font-bold">
                [{data.low.toFixed(2)} — {data.high.toFixed(2)}]
              </span>
            </div>
          </div>
          <p className="text-[9px] text-slate-500 leading-relaxed font-medium italic">
            *Interval reflects stochastic model uncertainty and historical climate variance.
          </p>
        </div>
      </div>
    );
  }
  return null;
};

// --- Main Component ---
export default function PremiumDashboard() {
  // Data state
  const [historicalData, setHistoricalData] = useState<CropData[]>([]);
  const [currentScore, setCurrentScore] = useState<ResilienceScore | null>(null);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCountry, setSelectedCountry] = useState("India");
  const [selectedCrop, setSelectedCrop] = useState("Wheat");
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showCropDropdown, setShowCropDropdown] = useState(false);

  // Prediction state
  const [predYear, setPredYear] = useState(2030);
  const [predTemp, setPredTemp] = useState(1.5);
  const [selectedModel, setSelectedModel] = useState("ols");
  const [compareMode, setCompareMode] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [comparativePredictions, setComparativePredictions] = useState<Record<string, PredictionResult> | null>(null);
  const [predicting, setPredicting] = useState(false);
  
  // Market Simulation State
  const [marketSimulation, setMarketSimulation] = useState<MarketSimulationResult | null>(null);
  const [simulatingMarket, setSimulatingMarket] = useState(false);

  // View toggle
  const [activeView, setActiveView] = useState<"chart" | "globe">("chart");
  const [showSatellite, setShowSatellite] = useState(false);

  // Timeline state
  const [timelineYear, setTimelineYear] = useState<number>(2024);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [timeseriesData, setTimeseriesData] = useState<TimeseriesData | null>(null);

  // --- Load data on mount ---
  useEffect(() => {
    const loadAll = async () => {
      try {
        const meta = await fetchMetadata();
        setMetadata(meta);
        
        // Initial historical data fetch for the default selection
        const initialData = await fetchHistoricalData(selectedCountry, selectedCrop);
        setHistoricalData(initialData);
        
        if (meta && meta.countries && meta.countries.length > 0) {
            if (!meta.countries.includes("India")) {
                const availableCountry = meta.countries[0];
                setSelectedCountry(availableCountry);
            }
        }
      } catch (err: any) {
        setError(`Failed to connect to API at ${process.env.NEXT_PUBLIC_API_URL || "localhost"}. Please ensure the backend is running and the URL is correct.`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  // --- Derived data ---
  const filteredTimeSeries = useMemo(() => {
    return historicalData
      .filter((d) => d.Country === selectedCountry && d.Crop === selectedCrop)
      .sort((a, b) => a.Year - b.Year)
      .map((d) => ({
        year: d.Year,
        yield: d.Yield_tonnes_ha,
        tempAnomaly: d.TempAnomaly_C,
        rollingAvg: d.RollingAvg_5yr,
      }));
  }, [historicalData, selectedCountry, selectedCrop]);

  // --- Fetch filtered historical data when selection changes ---
  useEffect(() => {
    const refreshData = async () => {
        try {
            const data = await fetchHistoricalData(selectedCountry, selectedCrop);
            setHistoricalData(data);
        } catch (err) {
            console.error("Failed to refresh historical data", err);
        }
    };
    if (selectedCountry && selectedCrop) {
        refreshData();
    }
  }, [selectedCountry, selectedCrop]);

  // --- Fetch specific score when selection changes ---
  useEffect(() => {
    const fetchScore = async () => {
      try {
        const score = await fetchSpecificScore(selectedCountry, selectedCrop);
        setCurrentScore(score);
      } catch (err) {
        console.error("Failed to fetch specific score", err);
        setCurrentScore(null);
      }
    };
    if (selectedCountry && selectedCrop) {
      fetchScore();
    }
  }, [selectedCountry, selectedCrop]);

  // --- Fetch historical map data when crop changes ---
  useEffect(() => {
    if (selectedCrop) {
      // Fetch 3D globe timeseries
      fetchTimeseriesMap(selectedCrop)
        .then(setTimeseriesData)
        .catch(console.error);
    }
  }, [selectedCrop]);

  const avgYield = useMemo(() => {
    if (filteredTimeSeries.length === 0) return 0;
    return filteredTimeSeries.reduce((s, d) => s + d.yield, 0) / filteredTimeSeries.length;
  }, [filteredTimeSeries]);

  const latestTemp = useMemo(() => {
    if (filteredTimeSeries.length === 0) return 0;
    return filteredTimeSeries[filteredTimeSeries.length - 1]?.tempAnomaly || 0;
  }, [filteredTimeSeries]);

  const availableCrops = useMemo(() => {
    // FIX: Use country-specific crops if available to avoid empty dashboards
    if (metadata?.country_crop_map && metadata.country_crop_map[selectedCountry]) {
      return metadata.country_crop_map[selectedCountry];
    }
    
    // Fallback logic for initial load or older backends
    if (metadata?.crops && metadata.crops.length > 0 && !metadata.country_crop_map) {
      return metadata.crops;
    }

    const crops = new Set(
      historicalData.filter((d) => d.Country === selectedCountry).map((d) => d.Crop)
    );
    return Array.from(crops).sort();
  }, [historicalData, selectedCountry, metadata]);

  const availableCountries = useMemo(() => {
    return metadata?.countries || [];
  }, [metadata]);

  // Auto-select first available crop when country changes
  useEffect(() => {
    if (availableCrops.length > 0 && !availableCrops.includes(selectedCrop)) {
      setSelectedCrop(availableCrops[0]);
    }
  }, [availableCrops, selectedCrop]);

  // --- Handlers ---
  const handleSimulateMarket = useCallback(async () => {
    if (!comparativePredictions || !compareMode) return;
    setSimulatingMarket(true);
    setMarketSimulation(null);
    try {
      const result = await fetchMarketSimulation(selectedCountry, selectedCrop, predTemp, comparativePredictions);
      setMarketSimulation(result);
    } catch (err) {
      console.error("Simulation failed", err);
    } finally {
      setSimulatingMarket(false);
    }
  }, [selectedCountry, selectedCrop, predTemp, comparativePredictions, compareMode]);

  const handlePredict = useCallback(async () => {
    setPredicting(true);
    setPrediction(null);
    setComparativePredictions(null);
    setMarketSimulation(null);
    try {
      if (compareMode && metadata?.available_models) {
        const results = await fetchComparativePredictions(selectedCountry, selectedCrop, predYear, predTemp, metadata.available_models);
        setComparativePredictions(results);
      } else {
        const result = await fetchPrediction(selectedCountry, selectedCrop, predYear, predTemp, selectedModel);
        setPrediction(result);
      }
    } catch {
      // silently fail
    } finally {
      setPredicting(false);
    }
  }, [selectedCountry, selectedCrop, predYear, predTemp, compareMode, metadata, selectedModel]);

  // --- Export Handlers ---
  const dashboardRef = useRef<HTMLDivElement>(null);

  const handleExportCSV = useCallback(() => {
    if (filteredTimeSeries.length === 0) return;
    
    // Headers
    const headers = ["Year", "Yield (t/ha)", "Temp Anomaly (°C)", "Rolling Average (t/ha)"];
    
    // Rows
    const rows = filteredTimeSeries.map(d => [
      d.year,
      d.yield.toFixed(4),
      d.tempAnomaly.toFixed(4),
      d.rollingAvg.toFixed(4)
    ].join(","));
    
    const csvContent = [headers.join(","), ...rows].join("\n");
    
    // Trigger Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ProjectOmni_${selectedCountry}_${selectedCrop}_Data.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [filteredTimeSeries, selectedCountry, selectedCrop]);

  const handleExportPDF = useCallback(async () => {
    if (!dashboardRef.current) return;
    try {
      // Dynamic import to avoid Next.js SSR issues with browser APIs
      const html2pdf = (await import('html2pdf.js')).default;
      const element = dashboardRef.current;
      
      // html2canvas (used by html2pdf) crashes on modern CSS colors like lab() and oklch()
      // We temporarily proxy window.getComputedStyle to intercept and convert these unsupported colors
      const originalGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(el, pseudoElt) {
        const style = originalGetComputedStyle.call(window, el, pseudoElt);
        return new Proxy(style, {
          get(target, prop) {
            const val = target[prop as keyof CSSStyleDeclaration];
            if (typeof val === 'string' && (val.includes('lab(') || val.includes('oklch('))) {
              // Fallbacks for critical properties if they contain unsupported modern color spaces
              if (prop === 'backgroundColor' || prop === 'background') return 'rgba(255, 255, 255, 0)';
              if (prop === 'color') return 'rgb(51, 65, 85)'; // slate-700
              if (prop === 'borderColor') return 'rgba(0,0,0,0)';
              return 'rgb(0,0,0)'; // catch-all safe color
            }
            if (typeof val === 'function') {
              return val.bind(target);
            }
            return val;
          }
        });
      };

      const opt: any = {
        margin:       0,
        filename:     `ProjectOmni_Dashboard_${selectedCountry}_${selectedCrop}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#f8fafc', ignoreElements: (el: any) => el.classList && el.classList.contains('maplibregl-control-container') },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };

      await html2pdf().set(opt).from(element).save();
      
      // Restore original getComputedStyle
      window.getComputedStyle = originalGetComputedStyle;
    } catch (err) {
      console.error("PDF Export failed", err);
      // Ensure we restore even on error
      if ((window as any)._originalGetComputedStyle) {
        window.getComputedStyle = (window as any)._originalGetComputedStyle;
      }
    }
  }, [selectedCountry, selectedCrop]);


  // --- Extract Omni Super-Prediction ---
  const omniPrediction = useMemo(() => {
    return comparativePredictions ? comparativePredictions['omni_ensemble'] : null;
  }, [comparativePredictions]);

  // --- Prepare Comparative Chart Data ---
  const comparativeChartData = useMemo(() => {
    if (!comparativePredictions || !compareMode) return [];
    
    // Define a premium color palette for the models
    const colors: Record<string, string> = {
      'ols': '#0ea5e9',      // Sky Blue
      'xgboost': '#10b981',  // Emerald Green
      'arima/sarima': '#f59e0b', // Amber
      'prophet': '#8b5cf6',  // Violet
      'omni_ensemble': '#ec4899', // Pink glow
    };

    const yields = Object.values(comparativePredictions).map(d => d.predicted_yield_tonnes_ha);
    const minValidYield = Math.min(...yields);
    const maxValidYield = Math.max(...yields);

    return Object.entries(comparativePredictions)
      .filter(([modelName]) => modelName !== 'omni_ensemble')
      .map(([modelName, data]) => {
        const errorMinus = Math.max(0, data.predicted_yield_tonnes_ha - data.confidence_low);
        const errorPlus = Math.max(0, data.confidence_high - data.predicted_yield_tonnes_ha);

        return {
          model: modelName.toUpperCase(),
          y: data.predicted_yield_tonnes_ha,
          errorY: [errorMinus, errorPlus],
          low: data.confidence_low,
          high: data.confidence_high,
          color: colors[modelName] || '#64748b',
          confidenceScore: Math.max(0, 10 - (errorMinus + errorPlus)),
          pessimism: data.predicted_yield_tonnes_ha === minValidYield ? 10 : 5, 
          optimism: data.predicted_yield_tonnes_ha === maxValidYield ? 10 : 5,
          extrapolation: modelName === 'ols' ? 8 : 4
        };
    });
  }, [comparativePredictions, compareMode]);

  // --- Ensemble Stats ---
  const ensembleStats = useMemo(() => {
    if (!comparativeChartData || comparativeChartData.length === 0) return null;
    const baseModels = comparativeChartData.filter(d => d.model !== "OMNI_ENSEMBLE");
    if (baseModels.length === 0) return null;

    const maxData = baseModels.reduce((prev, current) => (prev.y > current.y) ? prev : current);
    const minData = baseModels.reduce((prev, current) => (prev.y < current.y) ? prev : current);
    const spread = maxData.y - minData.y;
    
    return {
      max: maxData,
      min: minData,
      spread,
      consensus: spread < 0.5 ? "High" : spread < 1.0 ? "Moderate" : "Low"
    };
  }, [comparativeChartData]);

  // --- Yield Probability Distribution Data ---
  const distributionData = useMemo(() => {
    if (!comparativeChartData || comparativeChartData.length === 0 || !ensembleStats) return [];
    
    // Find absolute min and max ranges to plot across all models
    let minBound = Number.MAX_VALUE;
    let maxBound = Number.MIN_VALUE;

    comparativeChartData.forEach(model => {
      // standard deviation proxy based on 95% Confidence Interval bounds
      const stdDev = Math.max(0.1, (model.high - model.low) / 4);
      minBound = Math.min(minBound, model.y - (stdDev * 3));
      maxBound = Math.max(maxBound, model.y + (stdDev * 3));
    });

    const step = (maxBound - minBound) / 100; // 100 points for a smooth curve
    const data = [];

    for (let x = minBound; x <= maxBound; x += step) {
      const point: any = { yield: parseFloat(x.toFixed(2)) };
      
      // Calculate probability density for each individual model
      comparativeChartData.forEach(model => {
        const stdDev = Math.max(0.1, (model.high - model.low) / 4);
        const exponent = Math.exp(-Math.pow(x - model.y, 2) / (2 * Math.pow(stdDev, 2)));
        const density = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * exponent;
        point[model.model] = parseFloat((density * 10).toFixed(2)); // Scale up density for viz
      });

      // Calculate Ensemble average density as a very faint background curve
      if (omniPrediction) {
        const ensStdDev = Math.max(0.1, (omniPrediction.confidence_high - omniPrediction.confidence_low) / 4);
        const ensExponent = Math.exp(-Math.pow(x - omniPrediction.predicted_yield_tonnes_ha, 2) / (2 * Math.pow(ensStdDev, 2)));
        const ensDensity = (1 / (ensStdDev * Math.sqrt(2 * Math.PI))) * ensExponent;
        point["ENSEMBLE"] = parseFloat((ensDensity * 10).toFixed(2));
      } else {
        point["ENSEMBLE"] = 0;
      }

      data.push(point);
    }
    return data;
  }, [comparativeChartData, ensembleStats, omniPrediction]);

  // --- Dynamic Ensemble Weights Data (Donut Chart) ---
  const ensembleWeightsData = useMemo(() => {
    if (!omniPrediction || !omniPrediction.weights) return [];
    
    const colors: Record<string, string> = {
      'ols': '#0ea5e9',
      'xgboost': '#10b981',
      'arima/sarima': '#f59e0b',
      'prophet': '#8b5cf6',
    };
    
    return Object.entries(omniPrediction.weights).map(([modelName, weight_pct]) => ({
      name: modelName.toUpperCase(),
      value: weight_pct,
      color: colors[modelName] || '#64748b'
    })).sort((a, b) => b.value - a.value);

  }, [omniPrediction]);

  // --- Climate Sensitivity Trajectories (Line Chart) ---
  const sensitivityData = useMemo(() => {
    if (!comparativeChartData || comparativeChartData.length === 0) return [];
    
    const baseTemp = predTemp;
    const data = [];
    
    // Generate a range from -2.0C to +4.0C relative to current slider
    for (let tempOffset = -2; tempOffset <= 4; tempOffset += 0.5) {
      const currentSimTemp = baseTemp + tempOffset;
      const point: any = { tempLabel: currentSimTemp > 0 ? `+${currentSimTemp.toFixed(1)}°C` : `${currentSimTemp.toFixed(1)}°C` };
      
      comparativeChartData.forEach(d => {
        const baseYield = d.y;
        let simYield = baseYield;
        
        // Very basic simulation to show divergent behaviors:
        if (d.model.includes('OLS')) {
           // Linear: continuous decline at high temps
           simYield = baseYield - (tempOffset * 0.15);
        } else if (d.model.includes('XGBOOST')) {
           // Non-linear: holds steady then drops sharply
           simYield = tempOffset > 2 ? baseYield - (tempOffset * 0.3) : baseYield - (tempOffset * 0.05);
        } else if (d.model.includes('ARIMA')) {
           // Time-series anchored: resists change but wide variance
           simYield = baseYield - (tempOffset * 0.1);
        } else {
           // Prophet: smooth logistic curve proxy
           simYield = baseYield - (tempOffset * 0.12);
        }
        
        point[d.model] = parseFloat(Math.max(0, simYield).toFixed(2));
      });
      data.push(point);
    }
    return data;
  }, [comparativeChartData, predTemp]);

  // --- Render ---

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0 rounded-full border-4 border-t-emerald-500 border-r-cyan-500 border-b-transparent border-l-transparent" 
            />
          </div>
          <p className="text-slate-500 font-medium">Connecting to Climate API...</p>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card max-w-md w-full text-center p-8 border border-red-100 shadow-[0_20px_50px_rgba(239,68,68,0.1)]"
        >
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Connection Protocol Failed</h2>
          <p className="text-slate-500 text-sm leading-relaxed mb-8">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all active:scale-[0.98] shadow-lg shadow-slate-200"
          >
            Re-establish Connection
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans text-slate-900 selection:bg-emerald-200" ref={dashboardRef}>
      
      {/* Background Ambient Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-300/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[50%] bg-cyan-300/20 rounded-full blur-[100px] pointer-events-none" />

      {/* Floating Pill Navigation */}
      <motion.nav
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-6 px-8 py-3 bg-white/80 backdrop-blur-2xl border border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-full"
      >
        <motion.div 
          whileHover={{ scale: 1.05, rotate: [0, -2, 2, -2, 0] }}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-2.5 font-black tracking-tighter text-xl mr-4 bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-cyan-600 cursor-default"
        >
          <div className="p-1.5 bg-gradient-to-br from-emerald-100 to-cyan-100 rounded-full shadow-inner">
             <Sprout className="w-5 h-5 text-emerald-600" />
          </div>
          <span>Project OMNI</span>
        </motion.div>

        {/* Country Filter */}
        <div className="relative flex items-center gap-4 text-sm font-medium text-slate-600">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => { setShowCountryDropdown(!showCountryDropdown); setShowCropDropdown(false); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-slate-100/50 cursor-pointer transition-colors"
          >
            <MapPin className="w-4 h-4" />
            <span>{selectedCountry}</span>
            <ChevronDown className="w-4 h-4 ml-1" />
          </motion.button>
          {showCountryDropdown && (
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute top-full left-0 mt-2 max-h-60 overflow-y-auto bg-white/90 backdrop-blur-xl border border-white/40 shadow-xl rounded-xl min-w-[140px] z-50"
            >
              {availableCountries.map((c) => (
                <button
                  key={c}
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-emerald-50 transition-colors ${c === selectedCountry ? "text-emerald-600 font-semibold bg-emerald-50/50" : "text-slate-700"}`}
                  onClick={() => { setSelectedCountry(c); setShowCountryDropdown(false); }}
                >
                  {c}
                </button>
              ))}
            </motion.div>
          )}

          {/* Crop Filter */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => { setShowCropDropdown(!showCropDropdown); setShowCountryDropdown(false); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-slate-100/50 cursor-pointer transition-colors"
          >
            <Sprout className="w-4 h-4" />
            <span>{selectedCrop}</span>
            <ChevronDown className="w-4 h-4 ml-1" />
          </motion.button>
          {showCropDropdown && (
            <motion.div 
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute top-full right-0 mt-2 max-h-60 overflow-y-auto bg-white/90 backdrop-blur-xl border border-white/40 shadow-xl rounded-xl min-w-[140px] z-50"
            >
              {availableCrops.map((c) => (
                <button
                  key={c}
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-emerald-50 transition-colors ${c === selectedCrop ? "text-emerald-600 font-semibold bg-emerald-50/50" : "text-slate-700"}`}
                  onClick={() => { setSelectedCrop(c); setShowCropDropdown(false); }}
                >
                  {c}
                </button>
              ))}
            </motion.div>
          )}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 ml-2 bg-slate-100/60 rounded-full p-0.5">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setActiveView("chart")}
            title="Switch to detailed historical yield charts"
            aria-label="Chart View"
            className={`p-1.5 rounded-full transition-all ${activeView === "chart" ? "bg-white shadow-sm text-emerald-600" : "text-slate-400 hover:text-slate-600"}`}
          >
            <BarChart3 className="w-4 h-4" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setActiveView("globe")}
            title="Switch to 3D global distribution view"
            aria-label="Globe View"
            className={`p-1.5 rounded-full transition-all ${activeView === "globe" ? "bg-white shadow-sm text-emerald-600" : "text-slate-400 hover:text-slate-600"}`}
          >
            <Globe className="w-4 h-4" />
          </motion.button>
        </div>

        {/* Satellite Toggle (Only visible in globe view) */}
        {activeView === "globe" && (
          <div className="flex items-center gap-2 ml-2 pl-4 border-l border-slate-200">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Satellite</span>
            <button
              onClick={() => setShowSatellite(!showSatellite)}
              className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-all duration-300 ease-in-out focus:outline-none ${
                showSatellite ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]' : 'bg-slate-300'
              }`}
            >
              <motion.span
                layout
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-0 ${
                  showSatellite ? 'ml-5.5' : 'ml-1'
                }`}
              />
            </button>
          </div>
        )}

        {/* Export Actions */}
        <div className="flex items-center gap-1 ml-4 bg-slate-100/60 rounded-full p-0.5">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleExportCSV}
            title="Download historical yield data as CSV"
            aria-label="Export to CSV"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-slate-600 hover:bg-white hover:shadow-sm"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold">CSV</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleExportPDF}
            title="Generate a PDF report of the current dashboard"
            aria-label="Export to PDF"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all text-slate-600 hover:bg-white hover:shadow-sm"
          >
            <FileText className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-semibold">PDF</span>
          </motion.button>
        </div>
      </motion.nav>

      {/* Main Content Grid */}
      <motion.main
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="relative z-10 max-w-7xl mx-auto pt-32 pb-12 px-6 grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        
        {/* Metric Card 1: Avg Yield */}
        <motion.div 
          variants={itemVariants} 
          whileHover={{ y: -8, scale: 1.02, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" }} 
          className="glass-card group border border-slate-200/60 shadow-sm transition-all duration-300"
        >

          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-400 mb-1">Average Yield</p>
              <h3 className="text-4xl font-black tracking-tighter text-slate-800 drop-shadow-sm">
                {avgYield.toFixed(1)} <span className="text-lg font-bold text-slate-400 ml-1">t/ha</span>
              </h3>
            </div>
            <div className="p-3 bg-emerald-50 rounded-2xl group-hover:bg-emerald-100 transition-colors shadow-inner">
              <Sprout className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
            <span className="px-2.5 py-1 bg-emerald-100/80 text-emerald-700 rounded-full">
              {filteredTimeSeries.length} pts
            </span>
            <span className="text-slate-500">{selectedCountry} • {selectedCrop}</span>
          </div>
        </motion.div>

        {/* Metric Card 2: Temp Anomaly */}
        <motion.div 
          variants={itemVariants} 
          whileHover={{ y: -8, scale: 1.02, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" }} 
          className="glass-card group border border-slate-200/60 shadow-sm transition-all duration-300"
        >

          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-400 mb-1">Latest Temp Anomaly</p>
              <h3 className="text-4xl font-black tracking-tighter text-slate-800 drop-shadow-sm">
                +{latestTemp.toFixed(2)} <span className="text-lg font-bold text-slate-400 ml-1">°C</span>
              </h3>
            </div>
            <div className="p-3 bg-amber-50 rounded-2xl group-hover:bg-amber-100 transition-colors shadow-inner">
              <ThermometerSun className="w-6 h-6 text-amber-500" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
            <span className={`px-2.5 py-1 rounded-full ${latestTemp > 0.8 ? "bg-amber-100/80 text-amber-700" : "bg-emerald-100/80 text-emerald-700"}`}>
              {latestTemp > 0.8 ? "High" : "Moderate"}
            </span>
            <span className="text-slate-500">Climate pressure {latestTemp > 0.8 ? "elevated" : "normal"}</span>
          </div>
        </motion.div>

        {/* Metric Card 3: Pearson Correlation */}
        <motion.div 
          variants={itemVariants} 
          whileHover={{ y: -8, scale: 1.02, boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)" }} 
          className="glass-card group border-l-4 border-cyan-500 shadow-sm transition-all duration-300"
        >

          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold text-slate-400 mb-1">Pearson Correlation (r)</p>
              <h3 className="text-4xl font-black tracking-tighter text-slate-800 drop-shadow-sm">
                {currentScore?.correlation?.toFixed(3) || "—"}
              </h3>
            </div>
            <div className="p-3 bg-cyan-50 rounded-2xl group-hover:bg-cyan-100 transition-colors shadow-inner">
              <Activity className="w-6 h-6 text-cyan-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
            <span className={`px-2.5 py-1 rounded-full ${currentScore?.trend === "increasing" ? "bg-emerald-100/80 text-emerald-700" : currentScore?.trend === "decreasing" ? "bg-red-100/80 text-red-700" : "bg-slate-100/80 text-slate-700"}`}>
              Trend: {currentScore?.trend || "—"}
            </span>
          </div>
        </motion.div>


        {/* Conditional: Chart View or Globe View */}
        {activeView === "chart" ? (
          <>
            {/* Hero Line Chart */}
            <motion.div variants={itemVariants} className="glass-card col-span-1 md:col-span-3 h-[450px] flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold tracking-tight text-slate-800">
                  Yield Trajectory — {selectedCountry} / {selectedCrop}
                </h2>
                <div className="flex items-center gap-4 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-400" /> <span>Yield (t/ha)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full border-2 border-amber-400" /> <span>Anomaly (°C)</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 w-full min-h-0">
                {filteredTimeSeries.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={filteredTimeSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorYield" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} dy={10} />
                      <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
                      <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
                      <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '5 5' }} />
                      <Area
                        yAxisId="left" type="monotone" dataKey="yield" stroke="#10b981" strokeWidth={3}
                        fillOpacity={1} fill="url(#colorYield)" activeDot={{ r: 6, strokeWidth: 0, fill: '#059669' }}
                      />
                      <Area
                        yAxisId="right" type="monotone" dataKey="tempAnomaly" stroke="#fbbf24" strokeWidth={2}
                        strokeDasharray="4 4" fill="none" activeDot={{ r: 4, fill: '#d97706' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                    No data for {selectedCountry} / {selectedCrop}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        ) : (
          /* Globe View */
          <motion.div variants={itemVariants} className="glass-card col-span-1 md:col-span-3 h-[500px] p-0 overflow-hidden relative">
            <Suspense fallback={
              <div className="flex items-center justify-center h-full gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading map...
              </div>
            }>
              <GlobeView 
                onPrediction={(r) => setPrediction(r)} 
                showSatellite={showSatellite} 
                selectedCrop={selectedCrop}
                currentYear={timelineYear}
                timeseriesData={timeseriesData}
              />
            </Suspense>
            
            {/* Timeline UI Component */}
            <Timeline 
              minYear={1961}
              maxYear={2024}
              currentYear={timelineYear}
              onChange={setTimelineYear}
              isPlaying={isPlaying}
              onPlayToggle={() => setIsPlaying(!isPlaying)}
              disabled={timeseriesData === null || Object.keys(timeseriesData).length === 0}
            />
            
            {/* Satellite Legend Overlay */}
            {showSatellite && (
              <div className="absolute top-4 right-4 z-[1000] bg-white/80 backdrop-blur-md border border-white/40 shadow-lg rounded-xl p-3 pr-8 min-w-[200px]">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">True Color Satellite</p>
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs text-slate-600 font-medium">Visible Earth Imagery</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-2 leading-tight">
                  Source: NASA GIBS Blue Marble<br/>(Next Generation composite)
                </p>
              </div>
            )}
            
          </motion.div>
        )}



        {/* Bottom Row: Prediction Panel Expanded */}
        <motion.div variants={itemVariants} className="glass-card col-span-1 md:col-span-3 h-auto min-h-[250px] relative overflow-hidden flex flex-col border-[2px] border-emerald-400/30 shadow-xl shadow-emerald-900/5 bg-white/90">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500" />
          <h2 className="text-xl font-bold tracking-tight text-slate-800 mb-5 flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 rounded-lg">
              <Crosshair className="w-5 h-5 text-emerald-600" />
            </div>
            Scenario Forecast Control
          </h2>
          
          <div className="flex-1 flex flex-col md:flex-row gap-8 overflow-visible mt-2">
            
            {/* Left side: Controls (2/3 width) */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-medium text-slate-500 flex justify-between">
                    <span>Target Year</span><span className="text-emerald-600 font-bold">{predYear}</span>
                  </label>
                  <input
                    type="range" min={2025} max={2050} value={predYear}
                    onChange={(e) => setPredYear(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-emerald-500 mt-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 flex justify-between">
                    <span>Temp Change</span><span className="text-amber-500 font-bold">+{predTemp.toFixed(1)}°C</span>
                  </label>
                  <input
                    type="range" min={0} max={40} value={predTemp * 10}
                    onChange={(e) => setPredTemp(Number(e.target.value) / 10)}
                    className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-amber-400 mt-2"
                  />
                </div>
              </div>

              <div className="space-y-4 pt-2">
                {/* Model Selection */}
                {!compareMode && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Forecast Model</label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full bg-white/50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-500 shadow-sm"
                    >
                      {metadata?.available_models?.map(m => (
                        <option key={m} value={m}>{m.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Compare Toggle */}
                <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl relative overflow-hidden shadow-sm">
                  <div className="absolute left-0 top-0 w-1.5 h-full bg-gradient-to-b from-cyan-400 to-emerald-400" />
                  <label className="text-sm font-bold text-slate-700 cursor-pointer select-none z-10 pl-2" onClick={() => setCompareMode(!compareMode)}>
                    Compare All Models
                  </label>
                  <button
                    onClick={() => setCompareMode(!compareMode)}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors z-10 ${compareMode ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : 'bg-slate-300'}`}
                  >
                    <span className={`transform transition duration-200 inline-block h-5 w-5 rounded-full bg-white shadow ${compareMode ? 'translate-x-2.5' : '-translate-x-2.5'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Right side: Action Button & Compact Result (1/3 width) */}
            <div className="md:w-1/3 flex flex-col justify-end gap-4 min-w-[280px]">
              
              {/* Conditional Results Box moved above button for better flow */}
              <div className="min-h-[90px]">
                {prediction && !compareMode && !predicting && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-3xl font-black text-emerald-600 mb-1">
                          {prediction.predicted_yield_tonnes_ha.toFixed(2)} <span className="text-sm text-emerald-600/60 font-medium">t/ha</span>
                        </p>
                        <p className="text-[10px] text-emerald-600/80 uppercase font-bold tracking-wider">
                          Model: {prediction.model_type}
                        </p>
                      </div>
                      <div className="p-2 bg-emerald-100/80 rounded-lg">
                        <TrendingUp className="w-5 h-5 text-emerald-500" />
                      </div>
                    </div>
                  </motion.div>
                )}

                {omniPrediction && compareMode && !predicting && ensembleStats && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-xl bg-slate-900 border border-slate-700 text-white shadow-xl shadow-slate-900/20"
                  >
                     <div className="flex justify-between items-start">
                       <div>
                         <p className="text-3xl font-black text-white mb-1">
                          {omniPrediction.predicted_yield_tonnes_ha.toFixed(2)} <span className="text-sm font-normal text-slate-400">t/ha avg</span>
                         </p>
                         <p className="text-[10px] text-pink-400 uppercase font-bold tracking-widest flex items-center gap-1 mt-1">
                           <Globe className="w-3 h-3" /> ENSEMBLE
                         </p>
                       </div>
                       <div className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 flex flex-col items-center justify-center">
                         <p className="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Confidence</p>
                         <p className={`text-sm font-black text-pink-400`}>
                           ±{((omniPrediction.confidence_high - omniPrediction.confidence_low) / 2).toFixed(2)}
                         </p>
                       </div>
                     </div>
                  </motion.div>
                )}
              </div>

              <button
                onClick={handlePredict}
                disabled={predicting}
                className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-xl text-base font-bold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-3 border border-emerald-400/50"
              >
                {predicting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Crosshair className="w-5 h-5" />}
                {predicting ? "COMPUTING TENSOR DATA..." : "RUN SCENARIO FORECAST"}
              </button>

              {compareMode && comparativePredictions && (
                <button
                  onClick={handleSimulateMarket}
                  disabled={simulatingMarket}
                  className="w-full py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center justify-center gap-2 border border-indigo-400/50"
                >
                  {simulatingMarket ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                  {simulatingMarket ? "SIMULATING MARKET INTELLIGENCE..." : "RUN MARKET INTELLIGENCE AGENTS"}
                </button>
              )}
            </div>
            
          </div>
        </motion.div>

        {/* FULL WIDTH MODEL COMPARISON SECTION */}
        {compareMode && comparativePredictions && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="col-span-1 md:col-span-3 mt-6 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden relative"
          >
            {/* Background Glows */}
            <div className="absolute top-[20%] right-[10%] w-[30%] h-[60%] bg-emerald-500/10 rounded-full blur-[80px]" />
            <div className="absolute bottom-[-10%] left-[20%] w-[20%] h-[40%] bg-cyan-500/10 rounded-full blur-[60px]" />
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
              
              {/* Left Column: Composed Bar Chart with Error Bars */}
              <div className="col-span-1 md:col-span-2 flex flex-col h-[400px]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-slate-800 rounded-lg">
                    <Box className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white tracking-tight">Algorithmic Consensus</h2>
                    <p className="text-sm text-slate-400">Forecast models & 95% Confidence Intervals for {selectedCountry}</p>
                  </div>
                </div>
                
                <div className="flex-1 w-full min-h-0 bg-slate-950/50 rounded-xl border border-slate-800 p-4">
                  {comparativeChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={comparativeChartData} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#334155" />
                        <XAxis 
                          type="number" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 13 }}
                          domain={['auto', 'auto']}
                          tickFormatter={(val) => `${val} t`}
                        />
                        <YAxis 
                          dataKey="model" 
                          type="category" 
                          axisLine={false} 
                          tickLine={false}
                          tick={{ fill: '#f8fafc', fontSize: 13, fontWeight: 'bold' }} 
                          width={90}
                        />
                        <RechartsTooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} content={<ComparativeTooltip />} />
                        
                        <Bar dataKey="y" barSize={40} radius={[0, 4, 4, 0]}>
                          {comparativeChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                          <ErrorBar dataKey="errorY" width={6} strokeWidth={2} stroke="#f8fafc" />
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-500">
                      <Loader2 className="w-6 h-6 animate-spin mr-3" /> Processing simulation data...
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Radar Chart & Stats */}
              <div className="col-span-1 flex flex-col gap-6 h-[400px]">
                
                {/* Radar Chart Component */}
                <div className="flex-1 bg-slate-950/50 rounded-xl border border-slate-800 p-4 flex flex-col relative overflow-hidden">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest text-center mb-2">Model Character Traits</h3>
                  {comparativeChartData.length > 0 && (
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="65%" data={comparativeChartData}>
                        <PolarGrid stroke="#334155" />
                        <PolarAngleAxis dataKey="model" tick={{ fill: '#cbd5e1', fontSize: 10 }} />
                        <Radar name="Confidence" dataKey="confidenceScore" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                        <Radar name="Optimism" dataKey="optimism" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.1} />
                        <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                        <RechartsLegend wrapperStyle={{ fontSize: '10px' }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* KPI Min/Max Cards */}
                {ensembleStats && (
                  <div className="grid grid-cols-2 gap-4 h-[110px]">
                    <div className="bg-slate-800/80 rounded-xl border border-slate-700 p-4 flex flex-col justify-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Most Optimistic</p>
                      <p className="text-lg font-bold text-white">{ensembleStats.max.model}</p>
                      <p className="text-sm text-emerald-400">{ensembleStats.max.y.toFixed(2)} t/ha</p>
                    </div>
                    <div className="bg-slate-800/80 rounded-xl border border-slate-700 p-4 flex flex-col justify-center relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Most Pessimistic</p>
                      <p className="text-lg font-bold text-white">{ensembleStats.min.model}</p>
                      <p className="text-sm text-amber-400">{ensembleStats.min.y.toFixed(2)} t/ha</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row: Probability Distribution Matrix */}
            <div className="mt-8 pt-8 border-t border-slate-800 relative z-10 grid grid-cols-1 lg:grid-cols-4 gap-8">
              <div className="lg:col-span-1 flex flex-col justify-center">
                 <h2 className="text-2xl font-bold text-white tracking-tight leading-tight">Yield Probability Matrix</h2>
                 <p className="text-sm text-slate-400 mt-2 mb-6">
                   Visualizing the statistical likelihood of yield outcomes based on the variance across all active prediction models.
                 </p>
                 <div className="space-y-4">
                   <div className="flex flex-wrap gap-4 mt-6">
                     <div className="flex items-center gap-2 w-full mb-2">
                       <div className="w-4 h-1 border-t-2 border-dashed border-pink-500 opacity-50" />
                       <span className="text-xs text-pink-500 font-bold uppercase tracking-wider">ENSEMBLE</span>
                     </div>
                     {comparativeChartData.map((d, i) => (
                       <div key={i} className="flex items-center gap-2">
                         <div className="w-3 h-3 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.2)]" style={{ backgroundColor: d.color }} />
                         <span className="text-sm text-slate-300 font-medium">{d.model}</span>
                       </div>
                     ))}
                   </div>
                 </div>
              </div>

              <div className="lg:col-span-3 h-[250px] bg-slate-950/50 rounded-xl border border-slate-800 p-4 relative">
                {distributionData.length > 0 && (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={distributionData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorEnsemble" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ec4899" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#ec4899" stopOpacity={0.0}/>
                          </linearGradient>
                          {comparativeChartData.map((d, i) => (
                            <linearGradient key={`grad-${i}`} id={`color-${d.model.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={d.color} stopOpacity={0.5}/>
                              <stop offset="95%" stopColor={d.color} stopOpacity={0.0}/>
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                        <XAxis 
                          dataKey="yield" 
                          tick={{ fill: '#94a3b8', fontSize: 12 }} 
                          axisLine={false} 
                          tickLine={false}
                          tickFormatter={(v) => `${v}t`}
                        />
                        <RechartsTooltip 
                           contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                           labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                           formatter={(val: any, name: any) => [`${parseFloat(val).toFixed(2)} Density`, name]}
                           labelFormatter={(label) => `Yield: ${label} t/ha`}
                        />
                        {/* Render Ensemble as background dashed line */}
                        <Area 
                          type="monotone" 
                          dataKey="ENSEMBLE" 
                          stroke="#ec4899" 
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          fillOpacity={1} 
                          fill="url(#colorEnsemble)" 
                          activeDot={false}
                        />
                        {/* Render each model's distribution curve */}
                        {comparativeChartData.map((d, i) => (
                          <Area 
                            key={`area-${i}`}
                            type="monotone" 
                            dataKey={d.model} 
                            stroke={d.color} 
                            strokeWidth={3}
                            fillOpacity={1} 
                            fill={`url(#color-${d.model.replace(/[^a-zA-Z0-9]/g, '')})`} 
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                    
                    {/* Render Model Markers on the Distribution Axis */}
                    <div className="absolute bottom-4 left-[64px] right-[40px] h-6 pointer-events-none">
                      {comparativeChartData.map((d, i) => {
                        // Calculate percentage position along x-axis based on min/max of distribution
                        const minX = distributionData[0]?.yield || 0;
                        const maxX = distributionData[distributionData.length - 1]?.yield || 1;
                        const percent = Math.max(0, Math.min(100, ((d.y - minX) / (maxX - minX)) * 100));
                        
                        return (
                          <div 
                            key={`marker-${i}`} 
                            className="absolute bottom-0 w-3 h-3 rounded-full border-2 border-slate-900 shadow-lg transform -translate-x-1/2"
                            style={{ left: `${percent}%`, backgroundColor: d.color }}
                            title={d.model}
                          >
                            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-[9px] text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap hidden md:block">
                              {d.model}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Bottom Row Phase 2: Dynamic Weights & Climate Sensitivity */}
            <div className="mt-8 pt-8 border-t border-slate-800 relative z-10 grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Left: Dynamic Ensemble Weights */}
              <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-6 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-[40px]" />
                <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2 mb-1">
                  <Globe className="w-5 h-5 text-emerald-400" />
                  Dynamic Ensemble Weights
                </h3>
                <p className="text-xs text-slate-400 mb-6">Voting power distributed by confidence interval certainty.</p>
                
                <div className="flex-1 flex items-center justify-center relative min-h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={ensembleWeightsData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                      >
                        {ensembleWeightsData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                        itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                        formatter={(val: any) => [`${val}%`, 'Voting Power']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  
                  {/* Center Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-black text-white">{ensembleWeightsData[0]?.value}%</span>
                    <span className="text-[9px] text-slate-400 uppercase tracking-widest text-center mt-1">Lead<br/>Model</span>
                  </div>
                </div>

                {/* Custom Legend */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {ensembleWeightsData.map(d => (
                    <div key={d.name} className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="text-xs text-slate-300 font-medium truncate max-w-[80px]">{d.name}</span>
                      </div>
                      <span className="text-xs font-bold text-white">{d.value}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Climate Sensitivity Trajectories */}
              <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-6 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-[40px]" />
                <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2 mb-1">
                  <ThermometerSun className="w-5 h-5 text-cyan-400" />
                  Climate Sensitivity Trajectories
                </h3>
                <p className="text-xs text-slate-400 mb-6">Simulated model divergence across extreme temperature deltas.</p>
                
                <div className="flex-1 min-h-[250px] mt-2">
                   <ResponsiveContainer width="100%" height="100%">
                     <LineChart data={sensitivityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                       <XAxis 
                         dataKey="tempLabel" 
                         tick={{ fill: '#94a3b8', fontSize: 10 }} 
                         axisLine={false} 
                         tickLine={false} 
                         tickCount={5}
                       />
                       <YAxis 
                         tick={{ fill: '#94a3b8', fontSize: 10 }} 
                         axisLine={false} 
                         tickLine={false} 
                         domain={['auto', 'auto']}
                         tickFormatter={(v) => `${v.toFixed(1)}t`}
                       />
                       <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                          labelStyle={{ color: '#cbd5e1', marginBottom: '8px' }}
                          itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                          formatter={(val: any) => [`${parseFloat(val).toFixed(2)} t/ha`, '']}
                       />
                       {comparativeChartData.map((d, i) => (
                         <Line 
                           key={`line-${i}`}
                           type="monotone" 
                           dataKey={d.model} 
                           stroke={d.color} 
                           strokeWidth={2}
                           dot={false}
                           activeDot={{ r: 4, strokeWidth: 0, fill: d.color }}
                         />
                       ))}
                     </LineChart>
                   </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* --- AGENTIC MARKET SIMULATION PANEL --- */}
            {(simulatingMarket || marketSimulation) && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 border border-indigo-500/30 bg-indigo-950/20 rounded-2xl p-6 relative overflow-hidden"
              >
                {/* Decorative Glowing Orbs */}
                <div className="absolute top-[-50%] left-[-10%] w-[40%] h-[200%] bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none" />
                <div className="absolute bottom-[-50%] right-[-10%] w-[30%] h-[200%] bg-violet-500/10 rounded-full blur-[80px] pointer-events-none" />

                <div className="flex items-center gap-3 mb-6 relative z-10">
                  <div className="p-2.5 bg-indigo-500/20 border border-indigo-500/30 rounded-xl">
                    <Bot className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                      Market Intelligence Simulation 
                      {simulatingMarket && <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full animate-pulse border border-indigo-500/30">Thinking...</span>}
                    </h2>
                    <p className="text-sm text-indigo-200/60">Multi-Agent game theory analysis based on the algorithmic consensus.</p>
                  </div>
                </div>

                {simulatingMarket ? (
                   <div className="h-[200px] flex items-center justify-center relative z-10">
                      <div className="flex flex-col items-center gap-4 text-indigo-400">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-sm font-medium tracking-widest uppercase">Simulating Global Supply Chain Logistics...</p>
                      </div>
                   </div>
                ) : marketSimulation ? (
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                      
                      {/* Left: Adaptation Strategy */}
                      <div className="col-span-1 md:col-span-2 bg-slate-900/60 border border-slate-700/60 rounded-xl p-5 shadow-inner">
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                          <Activity className="w-3.5 h-3.5 text-emerald-400" />
                          Physical Adaptation Strategy
                        </h3>
                        <p className="text-base text-slate-200 leading-relaxed font-serif">
                          &ldquo;{marketSimulation.Adaptation_Strategy}&rdquo;
                        </p>
                        
                        <div className="mt-6 pt-5 border-t border-slate-800/80">
                          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                            <Globe className="w-3.5 h-3.5 text-cyan-400" />
                            Macro-Economic Impact (5 Year Horizon)
                          </h3>
                          <p className="text-sm text-slate-300 leading-relaxed">
                            {marketSimulation.Economic_Impact}
                          </p>
                        </div>
                      </div>

                      {/* Right: Disruption Gauge */}
                      <div className="col-span-1 bg-slate-900/60 border border-slate-700/60 rounded-xl p-5 flex flex-col items-center justify-center text-center">
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Market Disruption Severity</h3>
                        
                        <div className={`w-32 h-32 rounded-full border-[6px] flex items-center justify-center shadow-2xl mb-4
                          ${marketSimulation.Market_Disruption_Level === "Critical" ? "border-red-500 shadow-red-500/20 text-red-400" :
                            marketSimulation.Market_Disruption_Level === "High" ? "border-amber-500 shadow-amber-500/20 text-amber-400" :
                            marketSimulation.Market_Disruption_Level === "Medium" ? "border-yellow-400 shadow-yellow-400/20 text-yellow-300" :
                            "border-emerald-500 shadow-emerald-500/20 text-emerald-400"}
                        `}>
                           <div className="flex flex-col items-center gap-1">
                             <AlertTriangle className="w-6 h-6" />
                             <span className="text-xl font-black uppercase tracking-wider">{marketSimulation.Market_Disruption_Level}</span>
                           </div>
                        </div>

                        <p className="text-xs text-slate-400 max-w-[200px]">
                          Based on local economy reliance on {selectedCrop} production in {selectedCountry}.
                        </p>
                      </div>

                   </div>
                ) : null}

              </motion.div>
            )}

          </motion.div>
        )}

      </motion.main>

      {/* Injected CSS */}
      <style dangerouslySetInnerHTML={{__html: `
        .glass-card {
           background-color: rgba(255, 255, 255, 0.7);
           backdrop-filter: blur(16px);
           -webkit-backdrop-filter: blur(16px);
           border: 1px solid rgba(255, 255, 255, 0.4);
           box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
           border-radius: 1.25rem;
           padding: 1.5rem;
           transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .glass-card:hover {
           box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          cursor: pointer;
        }
      `}} />
    </div>
  );
}
