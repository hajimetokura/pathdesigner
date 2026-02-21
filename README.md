# PathDesigner

Node-based CAM system built with React Flow + FastAPI.

STEP input → Toolpath generation → OpenSBP output (ShopBot)

## Setup

```bash
cd backend && uv sync
cd frontend && npm install
```

## Dev

```bash
make dev    # Backend + Frontend 同時起動
make back   # Backend のみ
make front  # Frontend のみ
```

Open http://localhost:5173
