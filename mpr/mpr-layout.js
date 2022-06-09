/* eslint-disable react/prop-types */
import React, { Component } from 'react';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import {
  View2D,
  getImageData,
  loadImageData,
  vtkSVGRotatableCrosshairsWidget,
  vtkInteractorStyleRotatableMPRCrosshairs,
  vtkInteractorStyleMPRWindowLevel,
  vtkInteractorStyleMPRSlice,
} from '../util/react-vtkjs-viewport';
import { toLowHighRange } from '../util/react-vtkjs-viewport/lib/windowLevelRangeConverter';

import event from '../util/event';
import common from '../util/common';

class MPRLayout extends Component {
  constructor(props) {
    super(props);

    this.state = {
      seriesItem: props.seriesItem,
      layoutClassName: props.layoutClassName,
      studyInfo: {
        patientName: props.studyInfo.patient_name,
        patientId: props.studyInfo.patient_id,
      },
      volumes: [],
    };

    this.default = {
      windowWidth: 0,
      windowCenter: 0,
      scale: 1,
      position: null,
      focalPoint: null,
    };

    this.operations = this.initOperations();
  }

  async componentDidMount() {
    this._triggerProgressEvent(0.1);

    this.apis = [];

    const _createVolume = async (ctImageData) => {
      await this._triggerProgressEvent(0.6);

      // 這三個都是ctImageData裡的method
      // range : [-1024, 1973]
      // 先取得不知道什麼的range
      const range = ctImageData
        .getPointData()
        .getScalars()
        .getRange();

      // vtk mapper : https://vtk.org/doc/nightly/html/classvtkMapper.html
      // source : https://github.com/cabie8399/PROJECT--Vtkjs_Reading/blob/83be4744f3f6fdaa02570a53fb43f60342786d1d/vtk-js-master/Sources/Rendering/Core/VolumeMapper/index.js
      // vtk中mapper概念,取得ct的volumn
      const mapper = vtkVolumeMapper.newInstance();
      const ctVol = vtkVolume.newInstance();
      const rgbTransferFunction = ctVol.getProperty().getRGBTransferFunction(0);
      console.log('60L mapper => ', mapper);

      mapper.setInputData(ctImageData);
      // setMaximumSamplesPerRay
      // vtk-js-master/Sources/Rendering/Core/VolumeMapper/index.d.ts
      // setMaximumSamplesPerRay(maximumSamplesPerRay: number): boolean;
      mapper.setMaximumSamplesPerRay(2000);
      rgbTransferFunction.setRange(range[0], range[1]);
      ctVol.setMapper(mapper);

      await this._triggerProgressEvent(0.8);

      this.setState(
        { volumes: [ctVol] },
        async () => {
          await this._triggerProgressEvent(1);
          const volumeReadyEvent = new CustomEvent(event.MPR_VOLUME_READY);
          cornerstone.events.dispatchEvent(volumeReadyEvent);
        },
      );
    };

    const items = await this.state.seriesItem.getItems();
    const imageIds = items.map((x) => x.imageId);
    const imageDataObject = getImageData(imageIds, this.state.seriesItem.seriesId);

    this.default.windowWidth = imageDataObject.imageMetaData0.windowWidth;
    this.default.windowCenter = imageDataObject.imageMetaData0.windowCenter;

    await this._triggerProgressEvent(0.3);

    if (imageDataObject.loaded) {
      await _createVolume(imageDataObject.vtkImageData);
    } else {
      const onAllPixelDataInsertedCallback = async () => {
        await _createVolume(imageDataObject.vtkImageData);
      };

      imageDataObject.onAllPixelDataInserted(onAllPixelDataInsertedCallback);
      loadImageData(imageDataObject);
    }

    this._setupEvents();
  }

  _triggerProgressEvent = async (progress) => {
    const progressEvent = new CustomEvent(event.MPR_VOLUME_PROGRESS, { detail: { progress } });
    cornerstone.events.dispatchEvent(progressEvent);
    await common.delay(50); // Delay 50 millisecond to show the progress view normally
  };

  _setupEvents = () => {
    const _createNamespaceEvent = (event) => `${event}.mpr`;

    const resetEvent = _createNamespaceEvent(event.MPR_TOOL_RESET);
    cornerstone.events.removeEventNamespaceListener(resetEvent);
    cornerstone.events.addEventNamespaceListener(
      resetEvent,
      () => { this.operations.reset(); },
    );

    const toolCrosshairsEvent = _createNamespaceEvent(event.MPR_TOOL_CROSSHAIRS);
    cornerstone.events.removeEventNamespaceListener(toolCrosshairsEvent);
    cornerstone.events.addEventNamespaceListener(
      toolCrosshairsEvent,
      () => { this.selectTool(vtkInteractorStyleRotatableMPRCrosshairs); },
    );

    const toolWwwcEvent = _createNamespaceEvent(event.MPR_TOOL_WINDOW_LEVEL);
    cornerstone.events.removeEventNamespaceListener(toolWwwcEvent);
    cornerstone.events.addEventNamespaceListener(
      toolWwwcEvent,
      () => { this.selectTool(vtkInteractorStyleMPRWindowLevel); },
    );

    const toolPanEvent = _createNamespaceEvent(event.MPR_TOOL_PAN);
    cornerstone.events.removeEventNamespaceListener(toolPanEvent);
    cornerstone.events.addEventNamespaceListener(
      toolPanEvent,
      () => { this.selectTool(vtkInteractorStyleMPRSlice); },
    );

    const resetWwwcEvent = _createNamespaceEvent(event.MPR_RESET_WINDOW_LEVEL);
    cornerstone.events.removeEventNamespaceListener(resetWwwcEvent);
    cornerstone.events.addEventNamespaceListener(
      resetWwwcEvent,
      () => { this.operations.resetWindowLevel(); },
    );

    const updateWwwcEvent = _createNamespaceEvent(event.MPR_UPDATE_WINDOW_LEVEL);
    cornerstone.events.removeEventNamespaceListener(updateWwwcEvent);
    cornerstone.events.addEventNamespaceListener(
      updateWwwcEvent,
      (e) => { this.operations.updateWindowLevel(e.detail.ww, e.detail.wc); },
    );

    const overlayEvent = _createNamespaceEvent(event.MPR_TOOL_TOGGLE_OVERLAY);
    cornerstone.events.removeEventNamespaceListener(overlayEvent);
    cornerstone.events.addEventNamespaceListener(
      overlayEvent,
      (e) => { this.operations.toggleViewportOverlay(e.detail.visible); },
    );
  };

  storeApi = (viewportIndex) => (api) => {
    this.apis[viewportIndex] = api;

    window.apis = this.apis;

    const { apis } = this;

    // Add rotatable svg widget
    api.addSVGWidget(
      vtkSVGRotatableCrosshairsWidget.newInstance(),
      'rotatableCrosshairsWidget',
    );

    this.operations.setInteractorStyle(vtkInteractorStyleRotatableMPRCrosshairs, api, viewportIndex);

    // set blend mode to MIP.
    const mapper = api.volumes[0].getMapper();
    if (mapper.setBlendModeToMaximumIntensity) {
      mapper.setBlendModeToMaximumIntensity();
    }

    api.setSlabThickness(0.1);

    // Its up to the layout manager of an app to know how many viewports are being created.
    if (apis[0] && apis[1] && apis[2]) {
      apis.forEach((api, index) => {
        api.svgWidgets.rotatableCrosshairsWidget.setApiIndex(index);
        api.svgWidgets.rotatableCrosshairsWidget.setApis(apis);
        api.svgWidgets.rotatableCrosshairsWidget.setStrokeColors(['#F2C94C', '#6FCF97', '#2D9CDB']);
        api.svgWidgets.rotatableCrosshairsWidget.setStrokeWidth(2);
        api.svgWidgets.rotatableCrosshairsWidget.setSelectedStrokeWidth(5);
      });

      this.operations.updateWindowLevel(this.default.windowWidth, this.default.windowCenter);
      apis[0].svgWidgets.rotatableCrosshairsWidget.resetCrosshairs(apis, 0);

      // Get the default zoom and pan information used to reset the view port
      const renderer = api.genericRenderWindow.getRenderer();
      const camera = renderer.getActiveCamera();
      this.default.scale = camera.getParallelScale();
      this.default.position = camera.getPosition();
      this.default.focalPoint = camera.getFocalPoint();
    }
  };

  initOperations = () => {
    const updateWindowLevel = (ww, wc) => {
      const lowHigh = toLowHighRange(ww, wc);

      apis.forEach((api) => {
        api.volumes[0]
          .getProperty()
          .getRGBTransferFunction(0)
          .setMappingRange(lowHigh.lower, lowHigh.upper);

        api.updateImage();
        api.updateVOI(ww, wc); // Update overlay
      });
    };

    const resetWindowLevel = () => {
      updateWindowLevel(this.default.windowWidth, this.default.windowCenter);
    };
    const setInteractorStyle = (iStyleFunc, api, apiIndex, callbacks = {}) => {
      const istyle = iStyleFunc.newInstance();

      if (iStyleFunc === vtkInteractorStyleMPRWindowLevel) {
        callbacks = {
          setOnLevelsChanged: (voi) => {
            const { windowWidth, windowCenter } = voi;

            // Sync other views and update overlay
            updateWindowLevel(windowWidth, windowCenter);
          },
        };
      }

      const showCrosshairs = (iStyleFunc === vtkInteractorStyleRotatableMPRCrosshairs);
      api.svgWidgets.rotatableCrosshairsWidget.setDisplay(showCrosshairs);
      api.svgWidgetManager.render();

      // add istyle
      api.setInteractorStyle({
        istyle,
        configuration: { apis, apiIndex },
        callbacks,
      });
    };

    const reset = () => {
      const { apis } = this;

      apis.forEach((api) => {
        // Reset slice
        const renderWindow = api.genericRenderWindow.getRenderWindow();
        const istyle = renderWindow.getInteractor().getInteractorStyle();
        const range = istyle.getSliceRange();
        istyle.setSlice((range[0] + range[1]) / 2);

        // Reset zoom and pan
        const renderer = api.genericRenderWindow.getRenderer();
        const camera = renderer.getActiveCamera();
        camera.setParallelScale(this.default.scale);
        camera.setPosition(this.default.position);
        camera.setFocalPoint(this.default.focalPoint);

        // Reset rotate
        api.resetOrientation();

        // Reset ww/wc
        resetWindowLevel();
      });

      // Reset the crosshairs
      apis[0].svgWidgets.rotatableCrosshairsWidget.resetCrosshairs(apis, 0);
    };

    const toggleViewportOverlay = (visible) => {
      const infoOverlays = [...document.querySelectorAll('.ViewportOverlay')];

      infoOverlays.forEach((overlay) => {
        overlay.classList.toggle('d-none', !visible);
      });
    };

    return {
      setInteractorStyle,
      reset,
      resetWindowLevel,
      updateWindowLevel,
      toggleViewportOverlay,
    };
  };

  handleSlabThicknessChange(evt) {
    const { value } = evt.target;
    const valueInMM = value / 10;
    const { apis } = this;

    apis.forEach((api) => {
      const renderWindow = api.genericRenderWindow.getRenderWindow();

      api.setSlabThickness(valueInMM);
      renderWindow.render();
    });
  }

  selectTool = (iStyleFunc) => {
    apis.forEach((api, apiIndex) => {
      this.operations.setInteractorStyle(iStyleFunc, api, apiIndex);
    });
  };

  render() {
    if (!this.state.volumes || !this.state.volumes.length) {
      return <></>;
    }

    return (
      <>
        <div className={`viewer mpr-container ${this.props.layoutClassName}`}>
          <div id="axial-view" className={`viewer inner-viewer axial-view ${this.props.layoutClassName}`}>
            <View2D
              volumes={this.state.volumes}
              onCreated={this.storeApi(0)}
              orientation={{ sliceNormal: [0, 0, 1], viewUp: [0, -1, 0] }}
              showRotation={true}
              dataDetails={this.state.studyInfo}
            />
            <div className="tag">Axial View</div>
            <img className="full-screen-btn" title="Full Screen" src="img/mpr/full-screen-btn.svg"></img>
          </div>
          <div id="sagittal-view" className={`viewer inner-viewer sagittal-view ${this.props.layoutClassName}`}>
            <View2D
              volumes={this.state.volumes}
              onCreated={this.storeApi(1)}
              orientation={{ sliceNormal: [1, 0, 0], viewUp: [0, 0, 1] }}
              showRotation={true}
              dataDetails={this.state.studyInfo}
            />
            <div className="tag">Sagittal View</div>
            <img className="full-screen-btn" title="Full Screen" src="img/mpr/full-screen-btn.svg"></img>
          </div>
          <div id="coronal-view" className={`viewer inner-viewer coronal-view ${this.props.layoutClassName}`}>
            <View2D
              volumes={this.state.volumes}
              onCreated={this.storeApi(2)}
              orientation={{ sliceNormal: [0, 1, 0], viewUp: [0, 0, 1] }}
              showRotation={true}
              dataDetails={this.state.studyInfo}
            />
            <div className="tag">Coronal View</div>
            <img className="full-screen-btn" title="Full Screen" src="img/mpr/full-screen-btn.svg"></img>
          </div>
        </div>
      </>
    );
  }
}

export default MPRLayout;
