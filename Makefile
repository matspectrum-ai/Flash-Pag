.PHONY: test run fmt

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

run:
	go run ./cmd/flashpag
