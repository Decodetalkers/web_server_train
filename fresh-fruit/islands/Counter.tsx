import { type Signal, useSignal } from "@preact/signals";
import { Button } from "../components/Button.tsx";
import { useEffect } from "preact/hooks";

import shader from "./shader.wgsl?raw";

interface CounterProps {
  count: Signal<number>;
}
async function loadPlane(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  // Extract R channel → 1 byte per pixel
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = imageData.data[i * 4];
  }

  canvas.remove();
  return { data: out, width: img.width, height: img.height };
}
async function loadPlaneTwo(src: string, src2: string) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  const img2 = new Image();
  img2.src = src2;
  await img2.decode();

  const canvas2 = document.createElement("canvas");
  canvas2.width = img2.width;
  canvas2.height = img2.height;

  const ctx2 = canvas2.getContext("2d")!;
  ctx2.drawImage(img2, 0, 0);

  const imageData2 = ctx2.getImageData(0, 0, img2.width, img2.height);
  // Extract R channel → 1 byte per pixel
  const out = new Uint8Array(img.width * img.height * 2);
  for (let i = 0; i < img.width * img.height; i++) {
    out[i * 2] = imageData.data[i * 4];
    out[i * 2 + 1] = imageData2.data[i * 4];
  }

  canvas.remove();
  canvas2.remove();
  return { data: out, width: img.width, height: img.height };
}

async function draw() {
  const datay = await loadPlane("/cat-y.jpg");
  const datauv = await loadPlaneTwo("/cat-u.jpg", "/cat-v.jpg");

  const canvas = document.getElementById("video") as HTMLCanvasElement;

  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter();
  const device = await adapter?.requestDevice()!;
  const context = canvas.getContext("webgpu")! as unknown as GPUCanvasContext;
  const canvasFormat = gpu.getPreferredCanvasFormat();
  context.configure({ device: device, format: canvasFormat });

  const pipeLineShader = device.createShaderModule({
    label: "Cell shader",
    code: shader,
  });

  // TODO: need to be fixed
  const uniform = new Float32Array(256 / 4);
  uniform.set([
    -1,
    -1,
    1,
    1,
  ]);

  const texture_y = device.createTexture({
    label: "y",
    size: {
      width: datay.width,
      height: datay.height,
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "r8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    viewFormats: [],
  });
  const texture_uv = device.createTexture({
    label: "uv",
    size: {
      width: datauv.width,
      height: datauv.height,
      depthOrArrayLayers: 1,
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "rg8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    viewFormats: [],
  });

  const view_y = texture_y.createView({
    label: "y texture view",
    aspect: "all",
    baseMipLevel: 0,
  });
  const view_uv = texture_uv.createView({
    label: "uv texture view",
    aspect: "all",
    baseMipLevel: 0,
  });

  const instance = device.createBuffer({
    label: "yuv uniform buffer",
    size: uniform.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    mappedAtCreation: false,
  });

  device.queue.writeBuffer(instance, 0, uniform);
  const bg0_layout = device.createBindGroupLayout({
    label: "bind group 0 layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: "float",
          viewDimension: "2d",
          multisampled: false,
        },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: "float",
          viewDimension: "2d",
          multisampled: false,
        },
      },

      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {
          type: "filtering",
        },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
        },
      },
    ],
  });

  const layout = device.createPipelineLayout({
    label: "video pipeline layout",
    bindGroupLayouts: [bg0_layout],
  });

  const pipeline = device.createRenderPipeline({
    label: "video player pipeline",
    layout: layout,
    vertex: {
      module: pipeLineShader,
      entryPoint: "vs_main",
    },
    multisample: {
      count: 1,
      mask: 1,
      alphaToCoverageEnabled: false,
    },
    fragment: {
      module: pipeLineShader,
      entryPoint: "fs_main",
      targets: [{
        format: canvasFormat,
        writeMask: GPUColorWrite.ALL,
      }],
    },
  });

  const sampler = device.createSampler({
    label: "yuv sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear",
    lodMinClamp: 0.0,
    lodMaxClamp: 1.0,
    maxAnisotropy: 1,
  });

  const bind_group = device.createBindGroup({
    label: "video bind group",
    layout: bg0_layout,
    entries: [
      { binding: 0, resource: view_y },
      { binding: 1, resource: view_uv },
      { binding: 2, resource: sampler },
      {
        binding: 3,
        resource: {
          buffer: instance,
          offset: 0,
          size: uniform.byteLength,
        },
      },
    ],
  });

  device.queue.writeTexture(
    {
      texture: texture_y,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
      aspect: "all",
    },
    datay.data,
    { offset: 0, bytesPerRow: datay.width, rowsPerImage: datay.height },
    { width: datay.width, height: datay.height, depthOrArrayLayers: 1 },
  );
  device.queue.writeTexture(
    {
      texture: texture_uv,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
      aspect: "all",
    },
    datauv.data,
    { offset: 0, bytesPerRow: datauv.width * 2, rowsPerImage: datauv.height },
    { width: datauv.width, height: datauv.height, depthOrArrayLayers: 1 },
  );

  const encoder = device.createCommandEncoder();

  const pass = encoder.beginRenderPass({
    label: "video renderer pass",
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "load",
      storeOp: "store",
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind_group, [0]);
  pass.draw(6, 1);

  pass.end();

  device.queue.submit([encoder.finish()]);
}

export default function Counter(props: CounterProps) {
  const title = useSignal("default");

  useEffect(() => {
    //const wsUrl = "ws://localhost:3000/ws";

    //const wsListener = new WebSocket(wsUrl);
    //wsListener.addEventListener("message", (event) => {
    //  title.value = event.data;
    //});
    draw();
    return () => {
      //wsListener.close();
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
          width="512"
          height="512"
          class="max-w-full max-h-full"
        />
      </div>
      <Button id="increment" onClick={() => props.count.value += 1}>+1</Button>
    </div>
  );
}
