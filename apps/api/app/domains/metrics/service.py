"""Prometheus text-format exporter for panel-wide telemetry.

Functional equivalent of Remnawave's prometheus-reporter: exposes panel-level
gauges (users, nodes, subscriptions) so an external Prometheus/Grafana stack can
scrape fleet health. Read-only; no secrets are emitted.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.nodes.models import Node
from app.domains.subscriptions.models import Subscription
from app.domains.users.models import User

PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


async def _count(session: AsyncSession, model: type, status: str | None = None) -> int:
    stmt = select(func.count()).select_from(model)
    if status is not None:
        stmt = stmt.where(model.status == status)
    return int(await session.scalar(stmt) or 0)


async def render_prometheus_metrics(session: AsyncSession) -> str:
    """Render panel gauges in Prometheus text exposition format (v0.0.4)."""

    gauges = [
        ("lumen_users_total", "Total registered users.", await _count(session, User)),
        (
            "lumen_users_active",
            "Users in active status.",
            await _count(session, User, "active"),
        ),
        ("lumen_nodes_total", "Total registered nodes.", await _count(session, Node)),
        (
            "lumen_nodes_active",
            "Nodes in active status.",
            await _count(session, Node, "active"),
        ),
        (
            "lumen_subscriptions_total",
            "Total subscriptions.",
            await _count(session, Subscription),
        ),
        (
            "lumen_subscriptions_active",
            "Subscriptions in active status.",
            await _count(session, Subscription, "active"),
        ),
    ]

    lines: list[str] = []
    for name, help_text, value in gauges:
        lines.append(f"# HELP {name} {help_text}")
        lines.append(f"# TYPE {name} gauge")
        lines.append(f"{name} {value}")
    return "\n".join(lines) + "\n"
