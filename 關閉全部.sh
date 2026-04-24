#!/bin/bash
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
