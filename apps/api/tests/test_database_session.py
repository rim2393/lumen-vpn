import pytest

from app.core.config import Settings
from app.db.session import create_engine


def test_production_rejects_in_memory_database() -> None:
    settings = Settings(environment="production")

    with pytest.raises(RuntimeError, match="persistent database"):
        create_engine(settings)
