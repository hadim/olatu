import typer

app = typer.Typer(name="wave-buoys-viewer", add_completion=False)


@app.command()
def scrape(name: str = "World") -> None:
    """
    A sample command that prints a greeting.
    """
    print(f"scraping, {name}!")


if __name__ == "__main__":
    app()
