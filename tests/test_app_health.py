import httpx

from hugin.app import create_app


async def test_health_ok(tmp_path, monkeypatch):
    monkeypatch.setenv("HUGIN_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("HUGIN_RUNS_DIR", str(tmp_path / "runs"))
    app = create_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "name": "hugin"}
