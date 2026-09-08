FROM node:22-alpine AS web-build
ARG VITE_PREVIEW_READ_ONLY=false
ENV VITE_PREVIEW_READ_ONLY=$VITE_PREVIEW_READ_ONLY
WORKDIR /src
COPY web/package.json ./web/package.json
COPY web/tsconfig.json web/vite.config.ts web/index.html ./web/
COPY web/public ./web/public
COPY web/src ./web/src
RUN cd web && npm install --no-audit --no-fund && npm run build

FROM golang:1.24-alpine AS go-build
WORKDIR /src
COPY go.mod ./
COPY . .
COPY --from=web-build /src/internal/ui/dist ./internal/ui/dist
RUN CGO_ENABLED=0 GOOS=linux go test ./... && go build -trimpath -ldflags="-s -w" -o /out/flashpag ./cmd/flashpag

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go-build /out/flashpag /flashpag
EXPOSE 8080
ENTRYPOINT ["/flashpag"]
