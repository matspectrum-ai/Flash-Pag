FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go test ./... && go build -trimpath -ldflags="-s -w" -o /out/flashpag ./cmd/flashpag

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/flashpag /flashpag
EXPOSE 8080
ENTRYPOINT ["/flashpag"]
