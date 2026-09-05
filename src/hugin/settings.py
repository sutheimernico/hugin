from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HUGIN_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8770
    repo_root: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2])
    data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "data")
    runs_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "runs")
    claude_config_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / ".hugin" / "claude-config"
    )
    recordings_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / "demo" / "recordings"
    )
    claude_bin: str = "claude"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b"
    max_concurrent: dict[str, int] = {"claude": 3, "ollama": 1, "scripted": 8}
    log_ring: int = 5000

    @property
    def db_path(self) -> Path:
        return self.data_dir / "hugin.db"
