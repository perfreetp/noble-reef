/**
 * 盆内水面:平面反射(render target)+ 菲涅尔混合 + 轻微涟漪法线扰动
 * 基于 three Reflector 原理自实现,便于注入 fresnel 与涟漪
 */
import * as THREE from 'three';

const WaterShader = {
  uniforms: {
    tReflect: { value: null as THREE.Texture | null },
    uTextureMatrix: { value: new THREE.Matrix4() },
    uColor: { value: new THREE.Color('#1d2b26') },
    uFresnelPower: { value: 3.0 },
    uReflectionStrength: { value: 0.55 },
    uTime: { value: 0 },
  },
  vertex: /* glsl */ `
    uniform mat4 uTextureMatrix;
    varying vec4 vUvProj;
    varying vec3 vWorldPos;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vUvProj = uTextureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragment: /* glsl */ `
    uniform sampler2D tReflect;
    uniform vec3 uColor;
    uniform float uFresnelPower;
    uniform float uReflectionStrength;
    uniform float uTime;
    varying vec4 vUvProj;
    varying vec3 vWorldPos;

    void main() {
      // 涟漪:对投影采样坐标做法线扰动
      float ripple = sin(vWorldPos.x * 22.0 + uTime * 1.4) * cos(vWorldPos.z * 19.0 - uTime * 1.1);
      vec4 uv = vUvProj;
      uv.xy += ripple * 0.006 * uv.w;
      vec3 reflected = texture2DProj(tReflect, uv).rgb;

      // 菲涅尔:掠射角反射强,垂直看显水色
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float cosTheta = clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
      float fresnel = pow(1.0 - cosTheta, uFresnelPower);
      float mixAmount = clamp(fresnel * 1.2 + 0.08, 0.0, 1.0) * uReflectionStrength;

      vec3 color = mix(uColor, reflected, mixAmount);
      gl_FragColor = vec4(color, 0.92);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export class WaterRenderer {
  readonly mesh: THREE.Mesh;
  private renderTarget: THREE.WebGLRenderTarget;
  private virtualCamera = new THREE.PerspectiveCamera();
  private material: THREE.ShaderMaterial;
  private textureMatrix = new THREE.Matrix4();

  constructor(radius: number, y: number) {
    this.renderTarget = new THREE.WebGLRenderTarget(1024, 1024, {
      type: THREE.HalfFloatType,
    });
    const geo = new THREE.CircleGeometry(radius, 48);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(WaterShader.uniforms),
      vertexShader: WaterShader.vertex,
      fragmentShader: WaterShader.fragment,
      transparent: true,
    });
    this.material.uniforms.tReflect.value = this.renderTarget.texture;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = y;
  }

  setReflectionStrength(v: number): void {
    this.material.uniforms.uReflectionStrength.value = v;
  }

  /** 每帧:用镜像相机预渲染反射,再参与主渲染 */
  update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    time: number,
  ): void {
    this.material.uniforms.uTime.value = time;

    const cam = this.virtualCamera;
    // 镜像相机:主相机关于水面 y=h 的反射
    const waterY = this.mesh.position.y;
    cam.position.copy(camera.position);
    cam.position.y = 2 * waterY - camera.position.y;
    const target = new THREE.Vector3();
    camera.getWorldDirection(target);
    target.add(camera.position);
    target.y = 2 * waterY - target.y;
    cam.up.set(0, -1, 0);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    if (cam instanceof THREE.PerspectiveCamera && camera instanceof THREE.PerspectiveCamera) {
      cam.fov = camera.fov;
      cam.aspect = camera.aspect;
      cam.near = camera.near;
      cam.far = camera.far;
      cam.updateProjectionMatrix();
    }

    // 纹理矩阵:把世界坐标映射到反射相机的裁剪空间 [0,1]
    this.textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1,
    );
    this.textureMatrix.multiply(cam.projectionMatrix);
    this.textureMatrix.multiply(cam.matrixWorldInverse);
    this.textureMatrix.multiply(this.mesh.matrixWorld);
    // 注意:顶点着色器中对局部坐标应用,因此右乘 mesh 世界矩阵的逆已在采样端处理
    this.material.uniforms.uTextureMatrix.value = this.textureMatrix;

    // 渲染反射纹理(隐藏水面自身)
    this.mesh.visible = false;
    const currentRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(currentRT);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
