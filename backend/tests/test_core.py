import asyncio
from unittest.mock import AsyncMock, Mock, patch

from app.analyzer.block_analyzer import BlockAnalyzer
from app.services.ai_service import AIService
from app.validation import is_valid_bitcoin_address


def test_address_validation_rejects_malformed_values():
    assert not is_valid_bitcoin_address("not-an-address")
    assert is_valid_bitcoin_address("bc1qjn7e2xk99m4g4d4j3hszxqfh4uk585jq5m6dt7")


def test_block_analyzer_calculates_verified_metrics():
    result = BlockAnalyzer.analyze_block(
        {"id": "block-1", "height": 10, "timestamp": 100, "tx_count": 3},
        [
            {"txid": "tx-1", "fee": 100, "vin": [{"prevout": {"scriptpubkey_address": "addr1", "value": 100000000}}], "vout": [{"scriptpubkey_address": "addr2", "value": 200000000}]},
            {"txid": "tx-2", "fee": 200, "vin": [], "vout": [{"scriptpubkey_address": "addr3", "value": 300000000}]},
        ],
        1.25,
    )
    summary = result["block_summary"]
    assert summary["tx_count"] == 3
    assert summary["analyzed_tx_count"] == 2
    assert summary["coverage_pct"] == 66.67
    assert summary["total_volume_btc"] == 5.0
    assert summary["total_fees_btc"] == 0.000003
    assert summary["largest_tx_btc"] == 3.0
    assert summary["avg_tx_btc"] == 2.5


def test_ai_without_key_returns_safe_fallback():
    service = AIService()
    service.groq_key = None
    result = asyncio.run(service.summarize_block({"height": 10, "tx_count": 2, "analyzed_tx_count": 2}))
    assert result["status"] == "unavailable"
    assert result["provider"] == "groq"
    assert "structured_payload" in result


def test_ai_parses_grounded_groq_json_response():
    service = AIService()
    service.groq_key = "test-key"
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": '{"summary":"Block 10 had partial analyzed coverage."}'}}]}

    client = AsyncMock()
    client.__aenter__.return_value.post.return_value = response
    with patch("app.services.ai_service.httpx.AsyncClient", return_value=client):
        result = asyncio.run(service.summarize_block({"height": 10, "tx_count": 3, "analyzed_tx_count": 2, "coverage_pct": 66.67}))

    assert result["status"] == "ok"
    assert result["provider"] == "groq"
    assert result["summary"] == "Block 10 had partial analyzed coverage."


def test_ai_malformed_groq_response_falls_back():
    service = AIService()
    service.groq_key = "test-key"
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": "not-json"}}]}

    client = AsyncMock()
    client.__aenter__.return_value.post.return_value = response
    with patch("app.services.ai_service.httpx.AsyncClient", return_value=client):
        result = asyncio.run(service.summarize_block({"height": 10}))

    assert result["status"] == "unavailable"
    assert "structured_payload" in result


def test_hourly_summary_includes_only_the_selected_window_and_excludes_end_boundary():
    service = AIService()
    service.groq_key = "test-key"
    payload = {
        "time_window": {"start_time": "2026-09-20T15:00:00+00:00", "end_time": "2026-09-20T16:00:00+00:00"},
        "blocks": [
            {"height": 101, "timestamp": 1758370800},
            {"height": 102, "timestamp": 1758374400},
            {"height": 103, "timestamp": 1758378000},
        ],
        "transactions": {"total": 4, "btc_transferred": 12.5, "avg_tx_btc": 3.125, "largest_tx_btc": 5.0, "smallest_tx_btc": 0.5},
        "addresses": {"top_addresses": [{"address": "addr-1", "tx_count": 2, "total_in_btc": 6.0, "total_out_btc": 1.5}]},
    }
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": '{"overview": "The hour was active.", "block_activity": "3 blocks were seen.", "transaction_activity": "4 transactions moved 12.5 BTC.", "address_activity": "Top address was addr-1.", "notable_patterns": "No unusual behavior stood out.", "investigation_focus": "Review the largest transfer and recurring address activity."}'}}]}

    client = AsyncMock()
    client.__aenter__.return_value.post.return_value = response
    with patch("app.services.ai_service.httpx.AsyncClient", return_value=client):
        result = asyncio.run(service.summarize_hourly_window(payload))

    assert result["status"] == "ok"
    assert result["overview"] == "The hour was active."
    assert result["block_activity"] == "3 blocks were seen."
    assert result["transaction_activity"] == "4 transactions moved 12.5 BTC."


def test_hourly_summary_no_data_response_is_clean():
    service = AIService()
    result = asyncio.run(service.summarize_hourly_window({
        "time_window": {"start_time": "2026-09-20T15:00:00+00:00", "end_time": "2026-09-20T16:00:00+00:00"},
        "blocks": [],
        "transactions": {"total": 0, "btc_transferred": 0.0},
        "addresses": {"top_addresses": []},
    }))
    assert result["status"] == "no_data"
    assert "No Bitcoin blocks" in result["message"]