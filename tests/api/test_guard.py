"""`/api` refuses requests that do not name this machine — DNS-rebinding protection."""

import httpx
import pytest


@pytest.mark.parametrize("host", ["evil.example", "evil.example:8770", "127.0.0.1.evil.example"])
async def test_a_foreign_host_header_is_refused(api, host):
    response = await api.client.get("/api/health", headers={"host": host})

    assert response.status_code == 421


@pytest.mark.parametrize("host", ["127.0.0.1:8770", "localhost:5177", "localhost", "[::1]:8770"])
async def test_loopback_hosts_are_served(api, host):
    response = await api.client.get("/api/health", headers={"host": host})

    assert response.status_code == 200


async def test_a_foreign_origin_is_refused_even_with_a_loopback_host(api):
    response = await api.client.post(
        "/api/missions",
        json={"goal": "x", "driver": "scripted"},
        headers={"origin": "http://evil.example"},
    )

    assert response.status_code == 403
    assert (await api.client.get("/api/runs")).json() == []


async def test_the_shells_own_origin_is_accepted(api):
    response = await api.client.get("/api/health", headers={"origin": "http://127.0.0.1:5177"})

    assert response.status_code == 200


async def test_the_guard_covers_the_event_stream_too(api):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app), base_url="http://evil.example"
    ) as client:
        response = await client.get("/api/runs")

    assert response.status_code == 421
