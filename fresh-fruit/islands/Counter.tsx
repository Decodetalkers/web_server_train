import { type Signal, useSignal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { useEffect } from "preact/hooks";

interface CounterProps {
  count: Signal<number>;
}

function draw() {
  const canvas = document.getElementById("video") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgb(200 0 0)";
  ctx.fillRect(10, 10, 50, 50);

  ctx.fillStyle = "rgb(0 0 200 / 50%)";
  ctx.fillRect(30, 30, 50, 50);
}

export default function Counter(props: CounterProps) {
  const title = useSignal("abc");

  useEffect(() => {
    const wsUrl = "ws://localhost:3000/ws";

    const wsListener = new WebSocket(wsUrl);
    wsListener.addEventListener("message", (event) => {
      title.value = event.data;
    });
    draw();
    return () => {
      wsListener.close();
    };
  }, []);
  return (
    <div class="flex gap-8 py-6">
      <Button id="decrement" onClick={() => props.count.value -= 1}>-1</Button>
      <div class="flex-col text-center items-center justify-center mx-20">
        <p class="text-3xl tabular-nums">{props.count}</p>
        <p class="text-3xl tabular-nums">{title.value}</p>
        <canvas
          id="video"
          width="150"
          height="150"
          class="max-w-full max-h-full"
        />
      </div>
      <Button id="increment" onClick={() => props.count.value += 1}>+1</Button>
    </div>
  );
}
