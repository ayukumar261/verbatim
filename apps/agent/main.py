import threading


def main() -> None:
    print("Hello, world", flush=True)
    threading.Event().wait()


if __name__ == "__main__":
    main()
