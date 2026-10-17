/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { GLASS_FRAGMENT_SHADER, GLASS_VERTEX_SHADER } from './glass-shaders'

export interface GlassRect {
  x: number
  y: number
  width: number
  height: number
}

/** CSS cover geometry, including the actual animated backdrop transform. */
export function coverImageRect(
  image: { width: number; height: number },
  box: GlassRect,
  positionX: number
): GlassRect {
  const scale = Math.max(box.width / image.width, box.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return {
    x: box.x + (box.width - width) * positionX,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

type Rgba = readonly [number, number, number, number]

/** Optical recipe for one kind of surface; lengths are CSS pixels. */
export interface GlassMaterial {
  refractionHeight: number
  refractionAmount: number
  dispersion: number
  depthEffect: boolean
  saturation: number
  highlight: number
  highlightWidth: number
  innerShadow: number
  surface: Rgba
  tint: Rgba
}

const DARK_SURFACE = [0.05, 0.055, 0.075] as const
const NO_TINT: Rgba = [0, 0, 0, 0]

/**
 * Three recipes: a wide bar (navigation), a pill button and a card with
 * chromatic dispersion in its corners. Buttons keep a flat lens so their text
 * stays readable; cards get the deep bulged rim.
 */
export const GLASS_MATERIALS = {
  bar: {
    refractionHeight: 12,
    refractionAmount: -47,
    dispersion: 0,
    depthEffect: false,
    saturation: 1.55,
    // The bar keeps only a whisper of rim and no inner shadow: a bright
    // bevel with a dark gap reads as a second outline around the navigation.
    highlight: 0.18,
    highlightWidth: 0.5,
    innerShadow: 0,
    surface: [...DARK_SURFACE, 0.075],
    tint: NO_TINT,
  },
  button: {
    refractionHeight: 12,
    refractionAmount: -47,
    dispersion: 0,
    depthEffect: false,
    saturation: 1.5,
    highlight: 0.5,
    highlightWidth: 0.5,
    innerShadow: 0,
    surface: [...DARK_SURFACE, 0.07],
    tint: NO_TINT,
  },
  card: {
    refractionHeight: 24,
    refractionAmount: -95,
    dispersion: 0.7,
    depthEffect: true,
    saturation: 1.55,
    highlight: 0.38,
    highlightWidth: 0.5,
    innerShadow: 0.1,
    surface: [...DARK_SURFACE, 0.1],
    tint: NO_TINT,
  },
} satisfies Record<string, GlassMaterial>

/** Accent wash for the primary action: #8FB8FF at 32%, hue-blended. */
export const PRIMARY_TINT: Rgba = [0x8f / 255, 0xb8 / 255, 1, 0.32]

export interface GlassFrame {
  rect: GlassRect
  imageRect: GlassRect
  heroTop: number
  heroHeight: number
  /** How much of the hero's dark scrim the shader reproduces itself (0–1). */
  scrim: number
  radius: number
  /** Direction the rim light comes from, radians, y down. */
  lightAngle: number
  material: GlassMaterial
  dpr: number
}

/** One small decorative surface. Text and interactions remain native DOM. */
export function createGlassRenderer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement
) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  })
  if (!gl) return null
  const shaders: WebGLShader[] = []
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  const dispose = (releaseContext = false) => {
    shaders.forEach((shader) => gl.deleteShader(shader))
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    if (releaseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  try {
    if (!program || !buffer || !texture) {
      throw new Error('WebGL allocation failed')
    }
    for (const [type, source] of [
      [gl.VERTEX_SHADER, GLASS_VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, GLASS_FRAGMENT_SHADER],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('WebGL shader allocation failed')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(
          gl.getShaderInfoLog(shader) || 'Glass shader compilation failed'
        )
      }
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Glass shader linking failed')
    }
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )
    const position = gl.getAttribLocation(program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    const uniforms = Object.fromEntries(
      [
        'uWallpaper',
        'uSize',
        'uOrigin',
        'uImageRect',
        'uHero',
        'uDpr',
        'uRadius',
        'uBlur',
        'uLens',
        'uLook',
        'uHiAngle',
        'uTint',
        'uSurface',
      ].map((name) => [name, gl.getUniformLocation(program, name)])
    )
    gl.uniform1i(uniforms.uWallpaper, 0)
    return {
      dispose,
      draw(frame: GlassFrame) {
        // 1.5x is enough for a blurred backdrop and keeps the fill rate down.
        const dpr = Math.min(Math.max(frame.dpr, 1), 1.5)
        const width = Math.max(1, Math.round(frame.rect.width * dpr))
        const height = Math.max(1, Math.round(frame.rect.height * dpr))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
          gl.viewport(0, 0, width, height)
        }
        const material = frame.material
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform2f(uniforms.uSize, frame.rect.width, frame.rect.height)
        gl.uniform2f(uniforms.uOrigin, frame.rect.x, frame.rect.y)
        gl.uniform4f(
          uniforms.uImageRect,
          frame.imageRect.x,
          frame.imageRect.y,
          frame.imageRect.width,
          frame.imageRect.height
        )
        gl.uniform3f(
          uniforms.uHero,
          frame.heroTop,
          frame.heroHeight,
          frame.scrim
        )
        gl.uniform1f(uniforms.uDpr, dpr)
        gl.uniform1f(uniforms.uRadius, frame.radius)
        // Near-clear glass: the reference softens the wallpaper by ~2 device px.
        gl.uniform1f(uniforms.uBlur, 1.5)
        gl.uniform4f(
          uniforms.uLens,
          material.refractionHeight,
          material.refractionAmount,
          material.dispersion,
          material.depthEffect ? 1 : 0
        )
        gl.uniform4f(
          uniforms.uLook,
          material.saturation,
          material.highlight,
          material.highlightWidth,
          material.innerShadow
        )
        gl.uniform1f(uniforms.uHiAngle, frame.lightAngle)
        gl.uniform4f(uniforms.uTint, ...material.tint)
        gl.uniform4f(uniforms.uSurface, ...material.surface)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      },
    }
  } catch (error) {
    dispose()
    console.warn(
      'Liquid glass uses CSS fallback:',
      error instanceof Error ? error.message : 'WebGL unavailable'
    )
    return null
  }
}
