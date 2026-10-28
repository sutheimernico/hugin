from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HUGIN_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8770
    # Extra hostnames `/api` accepts besides loopback, e.g. "wsl-claude,100.99.224.50" for a phone
    # on the tailnet. Comma-separated in the environment; without this the API stays loopback-only.
    allowed_hosts: Annotated[list[str], NoDecode] = []
    repo_root: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2])
    data_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "data")
    runs_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2] / "runs")
    claude_config_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / ".hugin" / "claude-config"
    )
    recordings_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / "demo" / "recordings"
    )
    # The only part of the filesystem a file-reading agent (smith) may look at. Defaults to this
    # repository; point it at the project the agents should analyse, never at a home directory.
    workspace_root: Path = Field(default_factory=lambda: Path(__file__).resolve().parents[2])
    claude_bin: str = "claude"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:7b"
    # Ollama serialises requests itself; the kernel slot only has to let a waiting planner
    # coexist with its workers (limit 1 would park every child behind the parent).
    max_concurrent: dict[str, int] = {"claude": 3, "ollama": 3, "scripted": 8}
    log_ring: int = 5000

    @field_validator("allowed_hosts", mode="before")
    @classmethod
    def _split_hosts(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [host.strip() for host in value.split(",") if host.strip()]
        return value

    @property
    def db_path(self) -> Path:
        return self.data_dir / "hugin.db"
