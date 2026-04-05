struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) cell: vec2f,
};

@group(0) @binding(0) var<uniform> grid: vec2f;

@vertex
fn vertexMain(
    @location(0) position: vec2f,
    @builtin(instance_index) instance: u32
) -> VertexOutput {
    let i = f32(instance);
    let cell = vec2f(i % grid.x, floor(i / grid.x));

    let cellOffset = cell / grid * 2;
    let gridPos = (position + 1) / grid - 1 + cellOffset;

    var output: VertexOutput;
    output.position = vec4f(gridPos, 0, 1);
    output.cell = cell;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let c = input.cell / grid;
    return vec4f(c, 1 - c.x, 1);
}
