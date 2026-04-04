import { type Signal, useSignal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { useEffect } from "preact/hooks";

interface CounterProps {
  count: Signal<number>;
}

async function draw() {
  const canvas = document.getElementById("video") as HTMLCanvasElement;

  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter();
  const device = await adapter?.requestDevice();
  const context = canvas.getContext("webgpu")! as unknown as GPUCanvasContext;
  const canvasFormat = gpu.getPreferredCanvasFormat();
  context.configure({ device: device!, format: canvasFormat });
  const encoder = device!.createCommandEncoder();

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: { r: 0.3, g: 0, b: 0.4, a: 1.0 },
      storeOp: "store",
    }],
  });

  pass.end();

  device!.queue.submit([encoder.finish()]);
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
