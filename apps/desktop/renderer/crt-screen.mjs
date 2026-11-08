/* A single small, scissored WebGL pass. No video, textures or shader downloads. */
import { CRT_CURVATURE } from './screen-geometry.mjs';
const vertex = `attribute vec2 position;
varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 resolution;
uniform vec4 portrait;
uniform vec4 avatar;
uniform float time;
uniform float glitch;
uniform float motion;
uniform float curvature;
float noise(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec4 sampleImage(vec2 p){
  vec2 st=(p-avatar.xy)/avatar.zw;
  if(st.x<0.||st.x>1.||st.y<0.||st.y>1.)return vec4(0.);
  return texture2D(image,st);
}
void main(){
  vec2 pixel=vec2(uv.x,1.-uv.y)*resolution;
  vec2 st=(pixel-portrait.xy)/portrait.zw;
  if(min(st.x,st.y)<0.||max(st.x,st.y)>1.)discard;
  vec2 q=st*2.-1.;
  vec2 warped=q*(1.+curvature*dot(q,q));
  vec2 p=(warped*.5+.5)*portrait.zw+portrait.xy;
  float row=floor(st.y*27.);
  float seed=floor(time*17.);
  float damaged=step(.69,noise(vec2(row,seed)));
  p.x+=glitch*damaged*(noise(vec2(row+6.,seed))-.5)*48.;
  p.x+=motion*sin(st.y*83.+time*1.3)*.32;
  float split=.48+glitch*(1.4+damaged*6.);
  vec4 center=sampleImage(p);
  vec4 red=sampleImage(p+vec2(split,0.));
  vec4 blue=sampleImage(p-vec2(split,0.));
  float a=max(center.a,max(red.a,blue.a));
  vec3 rgb=vec3(red.r,center.g,blue.b);
  float scan=.86+.14*cos(pixel.y*2.094395);
  vec3 phosphor=vec3(1.-.065*sin(pixel.x*2.094395),1.-.065*sin(pixel.x*2.094395+2.09),1.-.065*sin(pixel.x*2.094395+4.18));
  float vignette=1.-.14*dot(q,q);
  float flicker=1.+motion*.009*sin(time*8.2);
  rgb*=scan*phosphor*vignette*1.13*flicker;
  rgb+=vec3(.02,.035,.03)*noise(pixel+seed)*a;
  gl_FragColor=vec4(rgb,a);
}`;

export class CRTScreen {
  constructor(canvas, sprite, onModeChange = () => {}, getImage = () => sprite) {
    this.canvas = canvas;
    this.sprite = sprite;
    this.getImage = getImage;
    this.onModeChange = onModeChange;
    this.ready = false;
    this.lost = (event) => {
      event.preventDefault();
      this.ready = false;
      this.setMode('fallback');
    };
    this.restored = () => this.initialize();
    canvas.addEventListener('webglcontextlost', this.lost);
    canvas.addEventListener('webglcontextrestored', this.restored);
    this.initialize();
  }
  setMode(mode) {
    if (document.body.dataset.crt !== mode) {
      document.body.dataset.crt = mode;
      this.onModeChange();
    }
  }
  initialize() {
    try {
      const gl = (this.gl = this.canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      }));
      if (!gl) throw new Error('WebGL unavailable');
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          throw new Error('CRT shader unavailable');
        }
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, vertex),
        fs = compile(gl.FRAGMENT_SHADER, fragment);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.linkProgram(this.program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw new Error('CRT program unavailable');
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const position = gl.getAttribLocation(this.program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.uniforms = Object.fromEntries(
        ['image', 'resolution', 'portrait', 'avatar', 'time', 'glitch', 'motion', 'curvature'].map(
          (name) => [name, gl.getUniformLocation(this.program, name)],
        ),
      );
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.source = '';
      this.textureImage = null;
      this.ready = true;
      this.setMode('fallback');
    } catch {
      this.ready = false;
      this.setMode('fallback');
    }
  }
  draw({ now, frame, avatar, origin, ratio, glitch, reduced, visible }) {
    if (!this.ready) return;
    const gl = this.gl,
      u = this.uniforms;
    const w = Math.round(innerWidth * ratio),
      h = Math.round(innerHeight * ratio);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!visible || !this.sprite.complete || !this.sprite.naturalWidth) return;
    try {
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      const image = this.getImage();
      if (
        this.source !== this.sprite.src ||
        this.textureImage !== image ||
        this.textureRevision !== image.avatarTextureRevision
      ) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('CRT texture unavailable');
        this.source = this.sprite.src;
        this.textureImage = image;
        this.textureRevision = image.avatarTextureRevision;
      }
      gl.uniform1i(u.image, 0);
      gl.uniform2f(u.resolution, innerWidth, innerHeight);
      const x = frame.x - origin.x + 12,
        y = frame.y - origin.y + 14,
        width = frame.width - 24,
        height = frame.height - 44;
      gl.uniform4f(u.portrait, x, y, width, height);
      gl.uniform4f(u.avatar, avatar.x - origin.x, avatar.y - origin.y, avatar.width, avatar.height);
      gl.uniform1f(u.time, reduced ? 0 : now / 1000);
      gl.uniform1f(u.glitch, glitch);
      gl.uniform1f(u.motion, reduced ? 0 : 1);
      gl.uniform1f(u.curvature, CRT_CURVATURE);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.max(0, Math.floor(x * ratio)),
        Math.max(0, Math.floor(h - (y + height) * ratio)),
        Math.max(0, Math.ceil(width * ratio)),
        Math.max(0, Math.ceil(height * ratio)),
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
      this.setMode('webgl');
    } catch {
      this.ready = false;
      this.setMode('fallback');
    }
  }
  destroy() {
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    if (this.gl) {
      this.gl.deleteTexture(this.texture);
      this.gl.deleteBuffer(this.buffer);
      this.gl.deleteProgram(this.program);
    }
  }
}
