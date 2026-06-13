from urllib.parse import quote

from starlette.requests import Request

from app.domains.subscriptions.renderers import RenderedSubscription
from app.domains.subscriptions.router import _subscription_browser_page


def test_happ_browser_page_imports_raw_subscription(monkeypatch) -> None:
    captured_qr_values: list[str] = []

    def fake_qr_svg(value: str) -> str:
        captured_qr_values.append(value)
        return "<svg></svg>"

    monkeypatch.setattr(
        "app.domains.subscriptions.router._subscription_qr_svg",
        fake_qr_svg,
    )
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/sub/public-user/happ",
            "headers": [(b"host", b"sub.lumentech.tel")],
            "scheme": "https",
            "server": ("sub.lumentech.tel", 443),
            "query_string": b"",
        }
    )
    rendered = RenderedSubscription(
        body="vless://example",
        content_type="text/plain",
        filename="subscription.txt",
        headers={},
    )

    response = _subscription_browser_page(
        {
            "subscription": {"id": "public-user"},
            "metadata": {},
            "provider": {"name": "Lumen VPN"},
        },
        request=request,
        rendered=rendered,
        render_target="happ",
    )

    raw_url = "https://sub.lumentech.tel/sub/public-user/happ?raw=1"
    body = response.body.decode()

    assert captured_qr_values == [raw_url]
    assert f"happ://add/{quote(raw_url, safe='')}" in body
    assert f"happ://import/{quote(raw_url, safe='')}" in body
    assert 'data-url="https://sub.lumentech.tel/sub/public-user/happ?raw=1"' in body
