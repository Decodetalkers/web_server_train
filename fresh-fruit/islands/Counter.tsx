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

async function draw() {
  const datay = await loadPlane("/cat-y.jpg");
  const datau = await loadPlane("/cat-u.jpg");
  const datav = await loadPlane("/cat-v.jpg");

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

  const uniform = new Float32Array(256 / 4);
  uniform.set([0, 0, datay.width, datay.height]);
  console.log(uniform.length);

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
  const texture_u = device.createTexture({
    label: "u",
    size: {
      width: datau.width,
      height: datau.height,
      depthOrArrayLayers: 1,
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "r8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    viewFormats: [],
  });
  const texture_v = device.createTexture({
    label: "v",
    size: {
      width: datav.width,
      height: datav.height,
      depthOrArrayLayers: 1,
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "r8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    viewFormats: [],
  });

  const view_y = texture_y.createView({
    label: "y texture view",
    aspect: "all",
    baseMipLevel: 0,
  });
  const view_u = texture_u.createView({
    label: "u texture view",
    aspect: "all",
    baseMipLevel: 0,
  });
  const view_v = texture_v.createView({
    label: "v texture view",
    aspect: "all",
    baseMipLevel: 0,
  });
  const instance = device.createBuffer({
    label: "yuv uniform buffer",
    size: uniform.byteLength * 256,
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
        texture: {
          sampleType: "float",
          viewDimension: "2d",
          multisampled: false,
        },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {
          type: "filtering",
        },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: false,
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
      { binding: 1, resource: view_u },
      { binding: 2, resource: view_v },
      { binding: 3, resource: sampler },
      {
        binding: 4,
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
    { width: datay.height, height: datay.height, depthOrArrayLayers: 1 },
  );
  device.queue.writeTexture(
    {
      texture: texture_u,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
      aspect: "all",
    },
    datau.data,
    { offset: 0, bytesPerRow: datau.width, rowsPerImage: datau.height },
    { width: datau.height, height: datau.height, depthOrArrayLayers: 1 },
  );
  device.queue.writeTexture(
    {
      texture: texture_v,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
      aspect: "all",
    },
    datav.data,
    { offset: 0, bytesPerRow: datav.width, rowsPerImage: datav.height },
    { width: datav.height, height: datav.height, depthOrArrayLayers: 1 },
  );

  const encoder = device.createCommandEncoder();

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "load",
      storeOp: "store",
    }],
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind_group);
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
