import uvicorn

from hugin.app import create_app
from hugin.settings import Settings


def main() -> None:
    """Entry point for ``hugin-serve``: run the API on the configured host/port."""
    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
