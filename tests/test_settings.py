from hugin.settings import Settings


def test_defaults_bind_localhost_and_port_8770(monkeypatch, tmp_path):
    monkeypatch.setenv("HUGIN_DATA_DIR", str(tmp_path / "data"))
    s = Settings()
    assert s.host == "127.0.0.1"
    assert s.port == 8770
    assert s.data_dir == tmp_path / "data"
    assert s.max_concurrent == {"claude": 3, "ollama": 3, "scripted": 8}
    assert s.ollama_url == "http://127.0.0.1:11434"
    assert s.ollama_model == "qwen2.5:7b"
    assert s.claude_bin == "claude"


def test_allowed_hosts_default_to_loopback_only_and_split_on_commas(monkeypatch, tmp_path):
    monkeypatch.setenv("HUGIN_DATA_DIR", str(tmp_path / "data"))
    assert Settings().allowed_hosts == []

    monkeypatch.setenv("HUGIN_ALLOWED_HOSTS", "wsl-claude, 100.99.224.50 ,")
    assert Settings().allowed_hosts == ["wsl-claude", "100.99.224.50"]
