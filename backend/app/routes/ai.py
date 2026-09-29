from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.database import query_one, query_all
from app.services.ai_service import ai_service
from app.validation import is_valid_bitcoin_address

router = APIRouter(prefix="/api/ai", tags=["ai"])


class HourlySummaryRequest(BaseModel):
    start_time: str = Field(..., description="ISO-8601 datetime for the start of the one-hour analysis window")


def _coerce_start_datetime(value: str) -> datetime:
    """BIT_ANAMO stores block timestamps as Unix epoch seconds in UTC.
    We therefore interpret naive ISO values as UTC rather than local time so the one-hour
    window aligns precisely with the database timestamps and avoids off-by-one-hour drift."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid start_time. Use ISO-8601 format like 2026-09-20T15:00:00") from exc

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)

    if dt.year < 2009 or dt.year > 2100:
        raise HTTPException(status_code=400, detail="start_time is out of a reasonable range")
    return dt


@router.get("/block/{height_or_hash}")
async def get_block_ai_summary(height_or_hash: str):
    if height_or_hash.isdigit():
        block = query_one("SELECT * FROM blocks WHERE height = ?", (int(height_or_hash),))
    else:
        block = query_one("SELECT * FROM blocks WHERE hash = ?", (height_or_hash,))

    if not block:
        raise HTTPException(status_code=404, detail="Block not found")

    res = await ai_service.summarize_block(block)
    return res


@router.post("/hourly-summary")
async def get_hourly_ai_summary(payload: HourlySummaryRequest):
    start_dt = _coerce_start_datetime(payload.start_time)
    end_dt = start_dt + timedelta(hours=1)
    start_epoch = int(start_dt.timestamp())
    end_epoch = int(end_dt.timestamp())

    blocks = query_all(
        "SELECT * FROM blocks WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC, height ASC",
        (start_epoch, end_epoch),
    )

    if not blocks:
        result = {
            "status": "no_data",
            "provider": "groq",
            "message": "No Bitcoin blocks were received during this time window.",
            "time_window": {
                "start_time": start_dt.isoformat(),
                "end_time": end_dt.isoformat(),
                "label": f"{start_dt.strftime('%Y-%m-%d %H:%M')} → {end_dt.strftime('%Y-%m-%d %H:%M')}",
            },
            "blocks_analyzed": 0,
            "transactions_analyzed": 0,
            "aggregated": {
                "total_btc_transferred": 0.0,
                "average_transaction_btc": 0.0,
                "largest_transaction_btc": 0.0,
                "smallest_transaction_btc": 0.0,
            },
        }
        return result

    block_hashes = tuple(block["hash"] for block in blocks)
    transactions = query_all(
        "SELECT * FROM transactions WHERE block_hash IN ({}) ORDER BY timestamp ASC, block_height ASC".format(", ".join("?" for _ in block_hashes)),
        block_hashes,
    )
    address_activity = query_all(
        """
        SELECT address,
               COUNT(*) AS tx_count,
               SUM(CASE WHEN direction = 'IN' THEN amount_btc ELSE 0 END) AS total_in_btc,
               SUM(CASE WHEN direction = 'OUT' THEN amount_btc ELSE 0 END) AS total_out_btc
        FROM address_activity
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY address
        ORDER BY tx_count DESC, (total_in_btc + total_out_btc) DESC
        LIMIT 10
        """,
        (start_epoch, end_epoch),
    )

    total_transactions = len(transactions)
    btc_transferred = round(sum(float(tx["amount_btc"]) for tx in transactions), 8)
    avg_tx_btc = round(btc_transferred / total_transactions, 8) if total_transactions else 0.0
    largest_tx_btc = round(max((float(tx["amount_btc"]) for tx in transactions), default=0.0), 8)
    smallest_tx_btc = round(min((float(tx["amount_btc"]) for tx in transactions), default=0.0), 8)

    block_times = [int(block["timestamp"]) for block in blocks]
    if len(block_times) > 1:
        avg_gap_seconds = round(sum(b - a for a, b in zip(block_times, block_times[1:])) / (len(block_times) - 1), 2)
    else:
        avg_gap_seconds = 0.0

    hourly_payload = {
        "time_window": {
            "start_time": start_dt.isoformat(),
            "end_time": end_dt.isoformat(),
            "label": f"{start_dt.strftime('%H:%M')} → {end_dt.strftime('%H:%M')}",
        },
        "blocks": [
            {
                "height": int(block["height"]),
                "hash": block["hash"],
                "timestamp": int(block["timestamp"]),
                "tx_count": int(block["tx_count"]),
                "analyzed_tx_count": int(block["analyzed_tx_count"]),
                "total_volume_btc": float(block["total_volume_btc"]),
                "total_fees_btc": float(block["total_fees_btc"]),
                "avg_tx_btc": float(block["avg_tx_btc"]),
            }
            for block in blocks
        ],
        "transactions": {
            "total": total_transactions,
            "btc_transferred": btc_transferred,
            "avg_tx_btc": avg_tx_btc,
            "largest_tx_btc": largest_tx_btc,
            "smallest_tx_btc": smallest_tx_btc,
        },
        "addresses": {
            "top_addresses": [
                {
                    "address": row["address"],
                    "tx_count": int(row["tx_count"]),
                    "total_in_btc": round(float(row["total_in_btc"] or 0.0), 8),
                    "total_out_btc": round(float(row["total_out_btc"] or 0.0), 8),
                }
                for row in address_activity
            ]
        },
        "observations": {
            "first_block_height": int(blocks[0]["height"]),
            "last_block_height": int(blocks[-1]["height"]),
            "first_block_timestamp": int(blocks[0]["timestamp"]),
            "last_block_timestamp": int(blocks[-1]["timestamp"]),
            "blocks_received": len(blocks),
            "average_time_between_blocks_seconds": avg_gap_seconds,
            "total_btc_transferred": btc_transferred,
        }
    }

    result = await ai_service.summarize_hourly_window(hourly_payload)
    result["time_window"] = hourly_payload["time_window"]
    result["blocks_analyzed"] = len(blocks)
    result["transactions_analyzed"] = total_transactions
    result["aggregated"] = {
        "total_btc_transferred": btc_transferred,
        "average_transaction_btc": avg_tx_btc,
        "largest_transaction_btc": largest_tx_btc,
        "smallest_transaction_btc": smallest_tx_btc,
        "average_time_between_blocks_seconds": avg_gap_seconds,
        "first_block_height": int(blocks[0]["height"]),
        "last_block_height": int(blocks[-1]["height"]),
    }
    return result


@router.get("/address/{address}")
async def get_address_ai_summary(address: str):
    if not is_valid_bitcoin_address(address):
        raise HTTPException(status_code=400, detail="Invalid Bitcoin address format")
    addr_info = query_one("SELECT * FROM followed_addresses WHERE address = ?", (address,))
    if not addr_info:
        stats = query_one("""
        SELECT 
            COUNT(DISTINCT txid) as total_tx_count,
            MIN(block_height) as first_seen_height,
            MAX(block_height) as last_seen_height,
            SUM(CASE WHEN direction = 'IN' THEN amount_btc ELSE 0 END) as total_in_btc,
            SUM(CASE WHEN direction = 'OUT' THEN amount_btc ELSE 0 END) as total_out_btc
        FROM address_activity
        WHERE address = ?
        """, (address,))
        addr_info = {
            "address": address,
            "total_tx_count": stats["total_tx_count"] or 0,
            "total_in_btc": stats["total_in_btc"] or 0.0,
            "total_out_btc": stats["total_out_btc"] or 0.0,
            "first_seen_height": stats["first_seen_height"],
            "last_seen_height": stats["last_seen_height"]
        }

    res = await ai_service.summarize_address(addr_info)
    return res
