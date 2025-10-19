import logging
from typing import Annotated

import pandas as pd
import typer
from upath import UPath

from .scrap import scrap_wave_buoy_data

logger = logging.getLogger(__name__)

app = typer.Typer(name="wave-buoys-viewer", add_completion=False)


@app.command()
def scrape(data_path: Annotated[str, typer.Option(help="Path to the data file")]) -> None:
    data_path_obj = UPath(data_path)

    # If the data file already exists, read the latest data from it
    logger.info(f"📖 Reading existing data from {data_path}")
    if data_path_obj.exists():
        data = pd.read_parquet(str(data_path_obj))
    else:
        data = pd.DataFrame()

    # Scrap wave buoy data
    campaign_id = "camp=06403"
    logger.info(f"🔍 Scraping wave buoy data for campaign ID: {campaign_id}")
    new_data = scrap_wave_buoy_data(campaign_id=campaign_id)

    # Append new data and keep only the latest for duplicate campaign_id/datetime
    logger.info("🔄 Merging new data with existing data")
    data = pd.concat([data, new_data], ignore_index=True)
    data = data.drop_duplicates(subset=["campaign_id", "datetime"], keep="last")

    # Create directory if it does not exist
    data_path_obj.parent.mkdir(parents=True, exist_ok=True)

    # Save data to parquet file
    logger.info(f"💾 Saving merged data to {data_path}")
    data.to_parquet(str(data_path_obj), index=False)

    logger.info("✅ Data scraping and saving completed successfully.")


if __name__ == "__main__":
    app()
