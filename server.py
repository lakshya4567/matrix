import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Matrix")

class ChatRequest(BaseModel):
    messages: list[dict]

@app.get("/")
async def home():
    return FileResponse(BASE_DIR / "index.html")

@app.post("/api/chat")
async def chat(request: ChatRequest):
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Server API key is not configured.")

    payload = {
        "model": "openrouter/free",
        "messages": request.messages,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                json=payload,
                headers=headers,
            )
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach the AI provider.")

    if response.status_code >= 400:
        try:
            detail = response.json().get("error", {}).get("message", "AI provider returned an error.")
        except Exception:
            detail = "AI provider returned an error."
        raise HTTPException(status_code=response.status_code, detail=detail)

    data = response.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="Unexpected AI response.")

    return {"content": content}
