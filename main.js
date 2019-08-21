// 'use strict';

  /* global THREE */
  // just add airplanes :(

  function main() {
    const canvas = document.querySelector('#c');
    const renderer = new THREE.WebGLRenderer({canvas});

    const fov = 60;
    const aspect = 2;  // te canvas default
    const near = 0.1;
    const far = 10;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.z = 2.5;

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.1;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 4;
    controls.update();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#246');

    const pickingScene = new THREE.Scene();
    pickingScene.background = new THREE.Color(0);

    {
      const loader = new THREE.TextureLoader();
      const geometry = new THREE.SphereBufferGeometry(1, 64, 32);

      const indexTexture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-index-texture.png', render);
      indexTexture.minFilter = THREE.NearestFilter;
      indexTexture.magFilter = THREE.NearestFilter;

      const pickingMaterial = new THREE.MeshBasicMaterial({map: indexTexture});
      pickingScene.add(new THREE.Mesh(geometry, pickingMaterial));

      const texture = loader.load('https://threejsfundamentals.org/threejs/resources/data/world/country-outlines-4k.png', render);
      const material = new THREE.MeshBasicMaterial({map: texture});
      scene.add(new THREE.Mesh(geometry, material));
    }

    async function loadJSON(url) {
      const req = await fetch(url);
      return req.json();
    }

    async function AirplanesAPI(latmin = 45.8389, longmin = 5.9962, latmax= 47.8229, longmax= 10.5226){
      const api = `https://opensky-network.org/api/states/all?lamin=${latmin}&lomin=${longmin}&lamax=${latmax}&lomax=${longmax}`
      fetch(api)
        .then(Response =>{
          return console.log(Response.json)
        })
    }

    let numCountriesSelected = 0;
    let countryInfos;
    async function loadCountryData() {
      countryInfos = await loadJSON('https://threejsfundamentals.org/threejs/resources/data/world/country-info.json');  

      const lonFudge = Math.PI * 1.5;
      const latFudge = Math.PI;
      // these helpers will make it easy to position the boxes
      // We can rotate the lon helper on its Y axis to the longitude
      const lonHelper = new THREE.Object3D();
      // We rotate the latHelper on its X axis to the latitude
      const latHelper = new THREE.Object3D();
      lonHelper.add(latHelper);
      // The position helper moves the object to the edge of the sphere
      const positionHelper = new THREE.Object3D();
      positionHelper.position.z = 1;
      latHelper.add(positionHelper);

      const labelParentElem = document.querySelector('#labels');
      for (const countryInfo of countryInfos) {
        const {lat, lon, min, max, name} = countryInfo;

        // adjust the helpers to point to the latitude and longitude
        lonHelper.rotation.y = THREE.Math.degToRad(lon) + lonFudge;
        latHelper.rotation.x = THREE.Math.degToRad(lat) + latFudge;

        // get the position of the lat/lon
        positionHelper.updateWorldMatrix(true, false);
        const position = new THREE.Vector3();
        positionHelper.getWorldPosition(position);
        countryInfo.position = position;

        // compute the area for each country
        const width = max[0] - min[0];
        const height = max[1] - min[1];
        const area = width * height;
        countryInfo.area = area;

        // add an element for each country
        const elem = document.createElement('div');
        elem.textContent = name;
        labelParentElem.appendChild(elem);
        countryInfo.elem = elem;
      }
      requestRenderIfNotRequested();
    }
    loadCountryData();

    const tempV = new THREE.Vector3();
    const cameraToPoint = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();

    const settings = {
      minArea: 20,
      maxVisibleDot: -0.2,
    };

    function updateLabels() {
      // exit if we have not loaded the data yet
      if (!countryInfos) {
        return;
      }

      const large = settings.minArea * settings.minArea;
      // get a matrix that represents a relative orientation of the camera
      normalMatrix.getNormalMatrix(camera.matrixWorldInverse);
      // get the camera's position
      camera.getWorldPosition(cameraPosition);
      for (const countryInfo of countryInfos) {
        const {position, elem, area, selected} = countryInfo;
        const largeEnough = area >= large;
        const show = selected || (numCountriesSelected === 0 && largeEnough);
        if (!show) {
          elem.style.display = 'none';
          continue;
        }

        // Orient the position based on the camera's orientation.
        // Since the sphere is at the origin and the sphere is a unit sphere
        // this gives us a camera relative direction vector for the position.
        tempV.copy(position);
        tempV.applyMatrix3(normalMatrix);

        // compute the direction to this position from the camera
        cameraToPoint.copy(position);
        cameraToPoint.applyMatrix4(camera.matrixWorldInverse).normalize();

        // get the dot product of camera relative direction to this position
        // on the globe with the direction from the camera to that point.
        // 1 = facing directly towards the camera
        // 0 = exactly on tangent of the sphere from the camera
        // < 0 = facing away
        const dot = tempV.dot(cameraToPoint);

        // if the orientation is not facing us hide it.
        if (dot > settings.maxVisibleDot) {
          elem.style.display = 'none';
          continue;
        }

        // restore the element to its default display style
        elem.style.display = '';

        // get the normalized screen coordinate of that position
        // x and y will be in the -1 to +1 range with x = -1 being
        // on the left and y = -1 being on the bottom
        tempV.copy(position);
        tempV.project(camera);

        // convert the normalized position to CSS coordinates
        const x = (tempV.x *  .5 + .5) * canvas.clientWidth;
        const y = (tempV.y * -.5 + .5) * canvas.clientHeight;

        // move the elem to that position
        elem.style.transform = `translate(-50%, -50%) translate(${x}px,${y}px)`;

        // set the zIndex for sorting
        elem.style.zIndex = (-tempV.z * .5 + .5) * 100000 | 0;
      }
    }

    class GPUPickHelper {
      constructor() {
        // create a 1x1 pixel render target
        this.pickingTexture = new THREE.WebGLRenderTarget(1, 1);
        this.pixelBuffer = new Uint8Array(4);
      }
      pick(cssPosition, scene, camera) {
        const {pickingTexture, pixelBuffer} = this;

        // set the view offset to represent just a single pixel under the mouse
        const pixelRatio = renderer.getPixelRatio();
        camera.setViewOffset(
            renderer.context.drawingBufferWidth,   // full width
            renderer.context.drawingBufferHeight,  // full top
            cssPosition.x * pixelRatio | 0,        // rect x
            cssPosition.y * pixelRatio | 0,        // rect y
            1,                                     // rect width
            1,                                     // rect height
        );
        // render the scene
        renderer.setRenderTarget(pickingTexture);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        // clear the view offset so rendering returns to normal
        camera.clearViewOffset();
        //read the pixel
        renderer.readRenderTargetPixels(
            pickingTexture,
            0,   // x
            0,   // y
            1,   // width
            1,   // height
            pixelBuffer);

        const id =
            (pixelBuffer[0] <<  0) |
            (pixelBuffer[1] <<  8) |
            (pixelBuffer[2] << 16);

        return id;
      }
    }

    const pickHelper = new GPUPickHelper();

    function pickCountry(event) {
      // exit if we have not loaded the data yet
      if (!countryInfos) {
        return;
      }

      const position = {x: event.clientX, y: event.clientY};
      const id = pickHelper.pick(position, pickingScene, camera);
      if (id > 0) {
        // we clicked a country. Toggle its 'selected' property
        const countryInfo = countryInfos[id - 1];
        const selected = !countryInfo.selected;
        // if we're selecting this country and modifiers are not
        // pressed unselect everything else.
        if (selected && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          unselectAllCountries();
        }
        numCountriesSelected += selected ? 1 : -1;
        countryInfo.selected = selected;
      } else if (numCountriesSelected) {
        unselectAllCountries();
      }
      requestRenderIfNotRequested();
    }

    function unselectAllCountries() {
      numCountriesSelected = 0;
      countryInfos.forEach((countryInfo) => {
        countryInfo.selected = false;
      });
    }

    canvas.addEventListener('mouseup', pickCountry);

    let lastTouch;
    canvas.addEventListener('touchstart', (event) => {
      // prevent the window from scrolling
      event.preventDefault();
      lastTouch = event.touches[0];
    }, {passive: false});
    canvas.addEventListener('touchsmove', (event) => {
      lastTouch = event.touches[0];
    });
    canvas.addEventListener('touchend', () => {
      pickCountry(lastTouch);
    });

    function resizeRendererToDisplaySize(renderer) {
      const canvas = renderer.domElement;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const needResize = canvas.width !== width || canvas.height !== height;
      if (needResize) {
        renderer.setSize(width, height, false);
      }
      return needResize;
    }

    let renderRequested = false;

    function render() {
      renderRequested = undefined;

      if (resizeRendererToDisplaySize(renderer)) {
        const canvas = renderer.domElement;
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
      }

      controls.update();


      updateLabels();

      renderer.render(scene, camera);
    }
    render();

    function requestRenderIfNotRequested() {
      if (!renderRequested) {
        renderRequested = true;
        requestAnimationFrame(render);
      }
    }

    controls.addEventListener('change', requestRenderIfNotRequested);
    window.addEventListener('resize', requestRenderIfNotRequested);
  }

  main();
