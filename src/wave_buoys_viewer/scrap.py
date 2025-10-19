import base64
import datetime
import io

import httpx
import pandas as pd


def scrap_wave_buoy_data(campaign_id: str):
    campaign_id_base64 = base64.b64encode(campaign_id.encode()).decode()

    # URL from the curl command
    base_url = "https://candhis.cerema.fr"
    campaign_url = f"/_public_/campagne.php?{campaign_id_base64}"

    # Headers from the curl
    headers = {"user-agent": "Chrome/141.0.0.0 Safari/537.34"}

    # Use httpx Client to handle cookies automatically
    client = httpx.Client(base_url=base_url, headers=headers)

    # First, visit the main page to establish session if needed
    client.get("index.php")

    # Then get the campagne page
    response = client.get(campaign_url)
    response.raise_for_status()

    # Parse tables with pandas
    html_string = io.StringIO(response.text)
    tables = pd.read_html(html_string)

    assert len(tables) == 1

    # Get the dataframe
    data = tables[0]
    data["campaign_id"] = campaign_id

    # Move campaign_id to the first column
    data = data[["campaign_id"] + [col for col in data.columns if col != "campaign_id"]]

    # Rename columns
    data = data.rename(
        columns={
            "Date": "date",
            "Heure (TU)": "time",
            "H1/3 (m)": "height_1_3_m",
            "Hmax (m)": "height_max_m",
            "Th1/3 (s)": "period_1_3_s",
            "Dir. au pic (°)": "peak_direction_deg",
            "Etal. au pic (°)": "peak_spread_deg",
            "Temp. mer (°C)": "sea_temperature_c",
        }
    )

    # Convert date and time columns
    data["datetime"] = data[["date", "time"]].apply(
        lambda row: datetime.datetime.strptime(f"{row['date']} {row['time']}", "%d/%m/%Y %H:%M"),
        axis=1,
    )

    # Drop unnecessary columns
    data = data.drop(columns=["time", "date"])

    # Move datetime to the second column
    data = data[["campaign_id", "datetime"] + [col for col in data.columns if col not in ["campaign_id", "datetime"]]]

    return data
