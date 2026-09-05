from fastapi import FastAPI

from hugin.settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the hugin FastAPI application.

    The settings object is kept on ``app.state`` so routes and background tasks
    resolve it through the app instead of re-reading the environment.
    """
    settings = settings or Settings()
    app = FastAPI(title="hugin", version="0.1.0")
    app.state.settings = settings

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "name": "hugin"}

    return app


__all__ = ["create_app"]
