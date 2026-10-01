import pandas as pd
import argparse
import sys
import numpy as np

def convert_fao_to_omni(input_file, output_file):
    print(f"Reading FAO data from {input_file}...")
    try:
        # Read the CSV
        df = pd.read_csv(input_file, encoding='utf-8', on_bad_lines='skip')
        
        # Check if this is actually the FAO format (starts with Area Code, Area, Item Code, Item, Element...)
        if 'Area' not in df.columns or 'Item' not in df.columns or 'Element' not in df.columns:
            print("❌ Input does not look like standard FAOSTAT wide-format data (missing Area/Item/Element).")
            print(f"Found columns: {list(df.columns[:5])}...")
            sys.exit(1)
            
        print(f"Found {len(df)} rows of FAO data.")
        
        # We only care about Yield data
        if 'Element' in df.columns:
            df = df[df['Element'] == 'Yield']
            print(f"Filtered to Yield rows. {len(df)} rows remaining.")
            
        # The columns we want to keep as identifiers
        id_vars = [col for col in df.columns if not col.startswith('Y1') and not col.startswith('Y2')]
        
        # Melt the dataframe (wide to long)
        print("Pivoting data from wide to long format (Years into rows)...")
        melted = pd.melt(df, id_vars=id_vars, var_name='Year_Raw', value_name='Yield_Raw')
        
        # Clean up the Year column (e.g., 'Y1961' -> 1961)
        melted['Year'] = melted['Year_Raw'].str.replace('Y', '', regex=False).astype(int)
        
        # Clean Yield
        melted['Yield_Raw'] = pd.to_numeric(melted['Yield_Raw'], errors='coerce')
        
        # Determine conversion factor based on the Unit column if it exists
        # FAO usually reports yield in kg/ha, but sometimes hg/ha (hectograms)
        unit = df['Unit'].iloc[0] if 'Unit' in df.columns and len(df) > 0 else 'unknown'
        print(f"Detected Yield Unit: {unit}")
        
        if 'hg/ha' in unit.lower():
             melted['Yield'] = melted['Yield_Raw'] / 10000.0 # 10,000 hg in a tonne
        else:
             melted['Yield'] = melted['Yield_Raw'] / 1000.0  # Assumes kg/ha

        # Omni requires: Year, Country, Crop, Yield, TempAnomaly
        melted = melted.rename(columns={
            'Area': 'Country',
            'Item': 'Crop'
        })
        
        # Generate synthetic temperature anomalies for demonstration
        print("Generating synthetic temperature anomalies...")
        melted['Base_Anomaly'] = (melted['Year'] - 1960) * 0.02 - 0.2
        # Add random noise per country/year
        np.random.seed(42) # Deterministic
        noise = np.random.normal(0, 0.2, len(melted))
        melted['TempAnomaly'] = melted['Base_Anomaly'] + noise
        melted['TempAnomaly'] = melted['TempAnomaly'].apply(lambda x: round(x, 2))
        
        # Select and order final columns
        final_df = melted[['Year', 'Country', 'Crop', 'Yield', 'TempAnomaly']]
        
        # Drop rows where Yield is NaN or 0
        final_df = final_df.dropna(subset=['Yield'])
        final_df = final_df[final_df['Yield'] > 0]
        
        # Sort by Country, Crop, Year
        final_df = final_df.sort_values(['Country', 'Crop', 'Year'])
        
        # Save to Omni format
        print(f"Saving formatted data ({len(final_df)} records) to {output_file}...")
        final_df.to_csv(output_file, index=False)
        print("✅ Done! Data is ready for Project Omni ingestion.")
        print("You can now replace haskell-pipeline/data/raw_crop_data.csv with this file.")
        
    except Exception as e:
        print(f"❌ Error processing data: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Convert FAO crop data to Project Omni format')
    parser.add_argument('input', help='Input CSV file (FAOSTAT format)')
    parser.add_argument('output', help='Output CSV file path (e.g. formatted_data.csv)')
    
    args = parser.parse_args()
    convert_fao_to_omni(args.input, args.output)
