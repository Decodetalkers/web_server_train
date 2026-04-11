import { type Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";

import shader from "./shader.wgsl?raw";

interface CounterProps {
  count: Signal<number>;
}

type FrameMessage = {
  width: number;
  height: number;
  y_image: Uint8Array;
  uv_image: Uint8Array;
};

function decodeBytes(bytes: Uint8Array): FrameMessage {
  const width_1 = bytes[0];
  const width_2 = bytes[1];
  const width = (width_1 << 8) + width_2;
  const height_1 = bytes[2];
  const height_2 = bytes[3];
  const height = (height_1 << 8) + height_2;
  const image = bytes.slice(4);
  const y_image = image.slice(0, width * height);
  const uv_image = image.slice(width * height);
  return {
    width,
    height,
    y_image,
    uv_image,
  };
}

class CastView {
  width?: number;
  height?: number;
  device?: GPUDevice;
  inited: boolean;
  bind_group?: GPUBindGroup;
  pipeline?: GPURenderPipeline;
  texture_y?: GPUTexture;
  texture_uv?: GPUTexture;
  context?: GPUCanvasContext;
  constructor() {
    this.inited = false;
  }
  async draw(data: Blob) {
    const bytes = await data.bytes();
    const { width, height, y_image, uv_image } = decodeBytes(bytes);
    await this.init_layout(width, height);
    const device = this.device!;
    const texture_y = this.texture_y!;
    const texture_uv = this.texture_uv!;
    const context = this.context!;
    const pipeline = this.pipeline!;
    const bind_group = this.bind_group!;
    device.queue.writeTexture(
      {
        texture: texture_y,
        mipLevel: 0,
        origin: { x: 0, y: 0, z: 0 },
        aspect: "all",
      },
      new Uint8Array(y_image),
      { offset: 0, bytesPerRow: width, rowsPerImage: height },
      { width: width, height: height, depthOrArrayLayers: 1 },
    );
    device.queue.writeTexture(
      {
        texture: texture_uv,
        mipLevel: 0,
        origin: { x: 0, y: 0, z: 0 },
        aspect: "all",
      },
      new Uint8Array(uv_image),
      { offset: 0, bytesPerRow: width, rowsPerImage: height / 2 },
      { width: width / 2, height: height / 2, depthOrArrayLayers: 1 },
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
  async init_layout(width: number, height: number) {
    if (this.inited) {
      return;
    }
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

    uniform.set([
      -1,
      1,
      1,
      -1,
    ]);
    const texture_y = device.createTexture({
      label: "y",
      size: {
        width: width,
        height: height,
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
        width: width / 2,
        height: height / 2,
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
    this.device = device;
    this.bind_group = bind_group;
    this.pipeline = pipeline;
    this.inited = true;
    this.texture_y = texture_y;
    this.texture_uv = texture_uv;
    this.context = context;
  }
}

export default function Counter(_props: CounterProps) {
  useEffect(() => {
    const wsUrl = "ws://localhost:3000/ws";

    const cast_view = new CastView();
    const wsListener = new WebSocket(wsUrl);
    wsListener.addEventListener("message", (event) => {
      if (!(event.data instanceof Blob)) {
        return;
      }
      cast_view.draw(event.data);
    });
    return () => {
      wsListener.close();
    };
  }, []);
  return (
    <div class="flex gap-8 py-6">
      <canvas
        id="video"
        width="2800"
        height="1800"
        class="max-w-full max-h-full"
      />
    </div>
  );
}

