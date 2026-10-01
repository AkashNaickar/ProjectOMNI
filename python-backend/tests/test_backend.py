"""Test suite for the Project Omni backend.

Covers the dependency-free OLS model, ISO-3 country resolution,
registry integrity, and the bundled dataset shape.
"""

import csv
import json
import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import main  # noqa: E402


# ---------------------------------------------------------------------------
# OLSYieldModel (pure, dependency-free)
# ---------------------------------------------------------------------------

def _synthetic_data(n=20):
    """Perfectly linear series: yield = 1 + 0.05*(year-2000) - 0.2*temp."""
    rows = []
    for i in range(n):
        year = 2000 + i
        temp = (i % 5) * 0.1
        y = 1 + 0.05 * (year - 2000) - 0.2 * temp
        rows.append(
            {
                "Country": "Testland",
                "Crop": "Wheat",
                "Year": year,
                "TempAnomaly_C": temp,
                "Yield_tonnes_ha": y,
            }
        )
    return rows


def test_ols_fit_and_predict_recovers_linear_trend():
    m = main.OLSYieldModel()
    m.fit(_synthetic_data())
    assert m.is_trained
    result = m.predict("Testland", "Wheat", 2020, 0.0)
    assert result["predicted_yield"] == pytest.approx(2.0, abs=0.05)
    assert result["confidence_low"] < result["predicted_yield"] < result["confidence_high"]


def test_ols_predict_untrained_returns_zeroes():
    m = main.OLSYieldModel()
    result = m.predict("Nowhere", "Wheat", 2030, 0.5)
    assert result == {"predicted_yield": 0.0, "confidence_low": 0.0, "confidence_high": 0.0}


def test_ols_fit_empty_data_is_noop():
    m = main.OLSYieldModel()
    m.fit([])
    assert not m.is_trained


def test_ols_extrapolation_penalty_widens_confidence():
    m = main.OLSYieldModel()
    m.fit(_synthetic_data())
    near = m.predict("Testland", "Wheat", 2024, 0.0)
    far = m.predict("Testland", "Wheat", 2050, 0.0)
    near_width = near["confidence_high"] - near["confidence_low"]
    far_width = far["confidence_high"] - far["confidence_low"]
    assert far_width > near_width


# ---------------------------------------------------------------------------
# ISO-3 resolution
# ---------------------------------------------------------------------------

def test_get_iso3_registry_alias():
    assert main.get_iso3("Viet Nam") == "VNM"


def test_get_iso3_pycountry_fallback():
    assert main.get_iso3("Germany") == "DEU"


def test_get_iso3_unknown_returns_none():
    assert main.get_iso3("Atlantis") is None
    assert main.get_iso3("") is None


# ---------------------------------------------------------------------------
# Registry integrity
# ---------------------------------------------------------------------------

def test_country_registry_entries_have_iso3():
    assert main.COUNTRY_REGISTRY, "country_registry.json must not be empty"
    for name, entry in main.COUNTRY_REGISTRY.items():
        assert "iso3" in entry, f"{name} missing iso3"


def test_crop_registry_is_valid_json_mapping():
    path = os.path.join(BACKEND_DIR, "data", "crop_registry.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, dict)


# ---------------------------------------------------------------------------
# Bundled dataset
# ---------------------------------------------------------------------------

def test_cleaned_dataset_exists_with_expected_columns():
    path = os.path.join(BACKEND_DIR, "data", "cleaned_crop_data.csv")
    assert os.path.exists(path), "runtime dataset missing from repo"
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        first = next(reader)
    for col in ("Country", "Crop", "Year", "TempAnomaly_C", "Yield_tonnes_ha"):
        assert col in header, f"missing column {col}"
    assert first["Country"], "first row must have a country"


def test_model_factory_starts_untrained():
    factory = main.ModelFactory()
    assert not factory.is_trained
    assert factory.get_available_models() == []
