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

  // deno-fmt-ignore
  const vertices = new Float32Array([
    // X,      Y
    -0.8,     -0.8, // Triangle 1
    0.8,      -0.8,
    0.8,      0.8,

    -0.8,     -0.8, // Triangle 2
    0.8,       0.8,
    -0.8,      0.8,
  ]);
  const vertexBuffer = device!.createBuffer({
    label: "Cell vertices",
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device!.queue.writeBuffer(vertexBuffer, 0, vertices);

  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
      format: "float32x2",
      offset: 0,
      shaderLocation: 0, // Position. Matches @location(0) in the @vertex shader.
    }],
  };

  // Create the shader that will render the cells.
  const cellShaderModule = device!.createShaderModule({
    label: "Cell shader",
    code: `
          @vertex
          fn vertexMain(@location(0) position: vec2f)
            -> @builtin(position) vec4f {
            return vec4f(position, 0, 1);
          }

          @fragment
          fn fragmentMain() -> @location(0) vec4f {
            return vec4f(1, 0, 0, 1);
          }
        `,
  });

  // Create a pipeline that renders the cell.
  const cellPipeline = device!.createRenderPipeline({
    label: "Cell pipeline",
    layout: "auto",
    vertex: {
      module: cellShaderModule,
      entryPoint: "vertexMain",
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: cellShaderModule,
      entryPoint: "fragmentMain",
      targets: [{
        format: canvasFormat,
      }],
    },
  });

  // Clear the canvas with a render pass
  const encoder = device!.createCommandEncoder();

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
      storeOp: "store",
    }],
  });

  // Draw the square.
  pass.setPipeline(cellPipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertices.length / 2);

  pass.end();

  device!.queue.submit([encoder.finish()]);
}

export default function Counter(props: CounterProps) {
  const title = useSignal("default");

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
