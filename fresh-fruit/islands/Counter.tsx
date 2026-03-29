import { type Signal, useSignal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { useEffect } from "preact/hooks";

interface CounterProps {
  count: Signal<number>;
}

export default function Counter(props: CounterProps) {
  const title = useSignal("abc");

  useEffect(() => {
    const wsUrl = "ws://localhost:3000/ws";

    const wsListener = new WebSocket(wsUrl);
    wsListener.addEventListener("message", (event) => {
      title.value = event.data;
    });
    return () => {
      wsListener.close();
    };
  }, []);
  return (
    <div class="flex gap-8 py-6">
      <Button id="decrement" onClick={() => props.count.value -= 1}>-1</Button>
      <p class="text-3xl tabular-nums">{props.count}</p>
      <p class="text-3xl tabular-nums">{title.value}</p>
      <Button id="increment" onClick={() => props.count.value += 1}>+1</Button>
    </div>
  );
}
