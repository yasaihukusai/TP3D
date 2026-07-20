import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as CANNON from "cannon-es";
import GUI from "lil-gui";

class ThreeJSContainer {
    private scene!: THREE.Scene;
    private light!: THREE.Light;
    private rollMesh!: THREE.Mesh;
    private paperMesh!: THREE.Mesh;
    private coreMesh!: THREE.Mesh;

    private rollRadius = 1.0;
    private paperLength = 0.1;

    private fallenPapers: { mesh: THREE.Mesh; body: CANNON.Body }[] = [];
    private fallenCores: { mesh: THREE.Mesh; body: CANNON.Body }[] = [];
    private coreDropped = false;

    private world!: CANNON.World;

    private guiParams = {
        gravity: -9.82,
        restitution: 0.4,
        maxPaperLength: 2.0,
    };

    private readonly MIN_RADIUS = 0.15;
    private readonly ROLL_HEIGHT = 1.2;

    private camera!: THREE.PerspectiveCamera;
    private canvas!: HTMLCanvasElement;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private spareRollMesh!: THREE.Mesh;

    constructor() {}

    public createRendererDOM = (width: number, height: number, cameraPos: THREE.Vector3) => {
        const renderer = new THREE.WebGLRenderer();
        renderer.setSize(width, height);
        renderer.setClearColor(new THREE.Color(0x334455));
        renderer.shadowMap.enabled = true;

        this.canvas = renderer.domElement;

        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.camera.position.copy(cameraPos);
        this.camera.lookAt(new THREE.Vector3(0, 0, 0));

        const orbitControls = new OrbitControls(this.camera, this.canvas);
        orbitControls.mouseButtons = {
            LEFT: null,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE
        };

        this.createScene();
        this.setupMouseDrag();
        this.setupGUI();

        const render: FrameRequestCallback = (_time) => {
            orbitControls.update();
            renderer.render(this.scene, this.camera);
            requestAnimationFrame(render);
        }
        requestAnimationFrame(render);

        this.canvas.style.cssFloat = "left";
        this.canvas.style.margin = "10px";
        return this.canvas;
    }

    private createScene = () => {
        this.scene = new THREE.Scene();

        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, this.guiParams.gravity, 0)
        });
        this.world.defaultContactMaterial.restitution = this.guiParams.restitution;

        // 床
        const floorBody = new CANNON.Body({ mass: 0 });
        floorBody.addShape(new CANNON.Plane());
        floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        floorBody.position.set(0, -6, 0);
        this.world.addBody(floorBody);

        const floorMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshPhongMaterial({ color: 0x887766 })
        );
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = -6;
        this.scene.add(floorMesh);

        // 壁
        const wallMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshPhongMaterial({ color: 0xddccbb })
        );
        wallMesh.position.z = -2;
        this.scene.add(wallMesh);

        // 壁の当たり判定
        const wallBody = new CANNON.Body({ mass: 0 });
        wallBody.addShape(new CANNON.Plane());
        wallBody.position.set(0, 0, -2);
        this.world.addBody(wallBody);

        //操作方法
        const textTexture = this.createTextTexture([
            "左クリック＋ドラッグで紙を引き出す",
            "右クリック＋ドラッグでカメラ操作"
        ]);
        const textMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(16, 8),
            new THREE.MeshBasicMaterial({ map: textTexture, transparent: true })
        );
   
        textMesh.position.set(0, -2.0, -1.95);
        textMesh.rotation.z = 0.15; 
        this.scene.add(textMesh);

        // トイレットペーパーホルダー
        const holderMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 120 });
        const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 16);

        const leftArm = new THREE.Mesh(armGeo, holderMat);
        leftArm.position.set(-0.8, 2, 0.4);
        leftArm.rotation.x = Math.PI / 2;
        this.scene.add(leftArm);

        const rightArm = new THREE.Mesh(armGeo, holderMat);
        rightArm.position.set(0.8, 2, 0.4);
        rightArm.rotation.x = Math.PI / 2;
        this.scene.add(rightArm);

        const backBar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 1.8, 16),
            holderMat
        );
        backBar.position.set(0, 2, -0.4);
        this.scene.add(backBar);

        const wallMount = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 0.2, 0.4),
            holderMat
        );
        wallMount.position.set(0, 2, -1.8);
        this.scene.add(wallMount);

        // ペーパーの芯
        this.coreMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, this.ROLL_HEIGHT, 32),
            new THREE.MeshPhongMaterial({ color: 0x8B6343 })
        );
        this.coreMesh.rotation.z = Math.PI / 2;
        this.coreMesh.position.set(0, 2, 0);
        this.scene.add(this.coreMesh);

        // ロール本体
        this.rollMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(this.rollRadius, this.rollRadius, this.ROLL_HEIGHT, 64),
            new THREE.MeshPhongMaterial({ color: 0xffffff })
        );
        this.rollMesh.rotation.z = Math.PI / 2;
        this.rollMesh.position.set(0, 2, 0);
        this.scene.add(this.rollMesh);

        this.paperMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.9, 1),
            new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        );
        this.scene.add(this.paperMesh);
        this.updatePaperTransform();

        // 補充用の棚と予備
        const shelfMesh = new THREE.Mesh(
            new THREE.BoxGeometry(2, 0.1, 1.2),
            new THREE.MeshPhongMaterial({ color: 0x5C4033 })
        );
        shelfMesh.position.set(-3.5, 3.5, -1);
        this.scene.add(shelfMesh);

        this.spareRollMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 1.0, this.ROLL_HEIGHT, 32),
            new THREE.MeshPhongMaterial({ color: 0xffffff })
        );
        this.spareRollMesh.rotation.z = Math.PI / 2;
        this.spareRollMesh.position.set(-3.5, 4.5, -1);
        this.scene.add(this.spareRollMesh);

        // ライト
        this.light = new THREE.DirectionalLight(0xffffff, 2);
        this.light.position.set(3, 5, 5);
        this.light.castShadow = true;
        this.scene.add(this.light);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        const update: FrameRequestCallback = (_time) => {
            this.world.fixedStep();

            for (const p of this.fallenPapers) {
                p.mesh.position.copy(p.body.position);
                p.mesh.quaternion.copy(p.body.quaternion);
            }

            for (const c of this.fallenCores) {
                c.mesh.position.copy(c.body.position);
                c.mesh.quaternion.copy(c.body.quaternion);
            }

            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    private createTextTexture = (lines: string[]) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        canvas.width = 4096;
        canvas.height = 2048;

        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "black";
        
            ctx.font = "bold 160px 'Marker Felt', 'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(-0.05);

            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], 0, -150 + i * 300);
            }
        }
        return new THREE.CanvasTexture(canvas);
    }

    private updatePaperTransform = () => {
        const bottomOfRoll = -this.rollRadius + 2;
        const paperCenterY = bottomOfRoll - this.paperLength / 2;
        this.paperMesh.scale.set(1, this.paperLength, 1);
        this.paperMesh.position.set(0, paperCenterY, 0);
    }

    private updateRollMesh = () => {
        this.rollMesh.scale.set(this.rollRadius, 1, this.rollRadius);
    }

    private tearPaper = () => {
        const paperW = 0.9;
        const paperH = this.paperLength;
        const paperD = 0.05;

        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(paperW, paperH, paperD),
            new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        );
        mesh.position.copy(this.paperMesh.position);
        this.scene.add(mesh);

        const body = new CANNON.Body({ mass: 0.1 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(paperW / 2, paperH / 2, paperD / 2)));
        body.position.set(
            this.paperMesh.position.x,
            this.paperMesh.position.y,
            this.paperMesh.position.z
        );
        body.velocity.set(
            (Math.random() - 0.5) * 0.5,
            -0.5,
            (Math.random() - 0.5) * 0.3
        );
        body.angularVelocity.set(
            (Math.random() - 0.5) * 2,
            0,
            (Math.random() - 0.5) * 2
        );
        this.world.addBody(body);
        this.fallenPapers.push({ mesh, body });

        this.paperLength = 0.1;
        this.updatePaperTransform();
    }

    private dropCore = () => {
        if (this.coreDropped) return;
        this.coreDropped = true;

        this.rollMesh.visible = false;
        this.coreMesh.visible = false;

        const fallingCoreMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, this.ROLL_HEIGHT, 32),
            new THREE.MeshPhongMaterial({ color: 0x8B6343 })
        );
        this.scene.add(fallingCoreMesh);

        const fallingCoreBody = new CANNON.Body({ mass: 0.5 });
        fallingCoreBody.addShape(
            new CANNON.Cylinder(0.2, 0.2, this.ROLL_HEIGHT, 16)
        );
        fallingCoreBody.position.set(0, 2, 0);
        fallingCoreBody.quaternion.setFromEuler(0, 0, Math.PI / 2);
        fallingCoreBody.velocity.set(
            (Math.random() - 0.5) * 0.5,
            -0.5,
            (Math.random() - 0.5) * 0.5
        );
        this.world.addBody(fallingCoreBody);

        this.fallenCores.push({ mesh: fallingCoreMesh, body: fallingCoreBody });
    }

    private setupMouseDrag = () => {
        let isDragging = false;
        let previousMouseY = 0;

        window.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;

            const rect = this.canvas.getBoundingClientRect();
            if (event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom) {
                
                this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

                this.raycaster.setFromCamera(this.mouse, this.camera);
                
                const intersects = this.raycaster.intersectObject(this.spareRollMesh);
                if (intersects.length > 0) {
                    this.reloadRoll();
                    return;
                }
            }

            isDragging = true;
            previousMouseY = event.clientY;
        });

        window.addEventListener('mousemove', (event) => {
            if (!isDragging) return;
            const deltaY = event.clientY - previousMouseY;
            previousMouseY = event.clientY;

            if (deltaY > 0 && !this.coreDropped) {
                const pull = deltaY * 0.008;
                this.paperLength += pull;
                
                // 固定値 0.02
                this.rollRadius = Math.max(
                    this.MIN_RADIUS,
                    this.rollRadius - pull * 0.02 
                );
                
                this.updatePaperTransform();
                this.updateRollMesh();

                if (this.paperLength >= this.guiParams.maxPaperLength) {
                    this.tearPaper();
                }

                if (this.rollRadius <= this.MIN_RADIUS) {
                    this.dropCore();
                }
            }
        });

        window.addEventListener('mouseup', (event) => {
            if (event.button !== 0) return;
            isDragging = false;
        });
    }

    private reloadRoll = () => {
        this.coreDropped = false;
        
        this.coreMesh.visible = true;
        this.rollMesh.visible = true;

        this.rollRadius = 1.0;
        this.paperLength = 0.1;
        this.updateRollMesh();
        this.updatePaperTransform();
    }

    private setupGUI = () => {
        const gui = new GUI();

        gui.add(this.guiParams, 'gravity', -20, -1).name('重力').onChange((v: number) => {
            this.world.gravity.set(0, v, 0);
        });

        gui.add(this.guiParams, 'restitution', 0, 1).name('反発係数').onChange((v: number) => {
            this.world.defaultContactMaterial.restitution = v;
        });

        gui.add(this.guiParams, 'maxPaperLength', 1, 5).name('ちぎれる長さ');

        gui.add({ reset: () => this.resetScene() }, 'reset').name('すべてリセット');
    }

    private resetScene = () => {
        for (const p of this.fallenPapers) {
            this.scene.remove(p.mesh);
            this.world.removeBody(p.body);
        }
        this.fallenPapers = [];

        for (const c of this.fallenCores) {
            this.scene.remove(c.mesh);
            this.world.removeBody(c.body);
        }
        this.fallenCores = [];

        this.reloadRoll();
    }
}

window.addEventListener("DOMContentLoaded", init);

function init() {
    const container = new ThreeJSContainer();
    const viewport = container.createRendererDOM(640, 480, new THREE.Vector3(3, 2, 8));
    document.body.appendChild(viewport);
}