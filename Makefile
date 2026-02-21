.PHONY: dev back front

# Backend + Frontend simultaneous start (Ctrl+C once to stop both)
dev:
	@trap 'kill 0' INT; \
	$(MAKE) back & $(MAKE) front & \
	wait

# Backend only
back:
	cd backend && uv run uvicorn main:app --reload

# Frontend only
front:
	cd frontend && npm run dev
