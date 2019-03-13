/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import { TileKey } from "@here/harp-geoutils";
import { ExtrusionFeature } from "@here/harp-materials";
import { MathUtils } from "@here/harp-utils";
import { DataSource } from "./DataSource";
import { MapView, MapViewEventNames, RenderEvent } from "./MapView";
import { Tile } from "./Tile";

import * as THREE from "three";

/**
 * Animation states for extrusion effect
 */
export enum AnimatedExtrusionState {
    None,
    Started,
    Playing,
    Finished
}

/**
 * TODO
 */
export class AnimatedExtrusionHandler {
    /**
     * Animate the extrusion of the buildings if set to `true`.
     */
    static DEFAULT_ENABLED = true;
    /**
     * Duration of the building's extrusion in milliseconds
     */
    static DEFAULT_DURATION = 1000;
    /**
     * Minimum ratio value for extrusion effect
     */
    static DEFAULT_RATIO_MIN: number = 0.001;
    /**
     * Maximum ratio value for extrusion effect
     */
    static DEFAULT_RATIO_MAX: number = 1;

    private m_zoomLevelPrevious: number;
    private m_tileHandlerSet: Set<AnimatedExtrusionTileHandler> = new Set();
    private m_tileKeysAnimatedSet: Set<TileKey> = new Set();

    /**
     * Constructs a `AnimatedExtrusionHandler` instance.
     *
     * @param m_mapView Instance of [[MapView]] that passes `zoomLevel`
     * through the `zoom` poperty update
     */
    constructor(private m_mapView: MapView) {
        this.m_zoomLevelPrevious = this.m_mapView.zoomLevel;
    }

    /**
     * [[MapView]] updates zoom level. Then [[TileHandler]] calculate actual extrusion ratio
     * and trigger animation
     */
    set zoom(zoomLevel: number) {
        // if zoomLevel has been changed since last render
        if (this.m_zoomLevelPrevious !== zoomLevel) {
            this.m_zoomLevelPrevious = zoomLevel;

            this.m_tileHandlerSet.forEach(tileHandler => {
                tileHandler.zoomLevelChanged(zoomLevel);
            });
        }
    }

    /**
     * Add to the list of extruded tiles
     */
    tileExtruded(tileKey: TileKey) {
        this.m_tileKeysAnimatedSet.add(tileKey);
    }

    /**
     * Check if extrusion animation should be done for this tile
     */
    shouldAnimate(tile: Tile) {
        // TODO: dataSource: DataSource, mortonCode: number
        // for (const animatedTileKey of this.m_tileKeysAnimatedSet) {
        //     const animatedSubTileKeyMortons = dataSource
        //         .getTilingScheme()
        //         .getSubTileKeys(animatedTileKey)
        //         // tslint:disable-next-line:no-shadowed-variable
        //         .map(subTileKey => subTileKey.mortonCode());

        //     if (animatedSubTileKeyMortons.indexOf(mortonCode) !== -1) {
        //         return false;
        //     }
        // }

        return true;
    }

    /**
     * Subscribe [[Tile]] to zoom level updates from [[MapView]]
     */
    add(tileHandler: AnimatedExtrusionTileHandler): void {
        this.m_tileHandlerSet.add(tileHandler);
    }

    /**
     * Remove tile from the list subscribed for extrusion ratio updates
     */
    remove(tileHandler: AnimatedExtrusionTileHandler): void {
        this.m_tileKeysAnimatedSet.delete(tileHandler.tile.tileKey);
        this.m_tileHandlerSet.delete(tileHandler);
    }
}

/**
 * Implements animated extrusion effect for the extruded objects in the [[Tile]]
 */
export class AnimatedExtrusionTileHandler {
    private m_extrudedObjects: THREE.Object3D[] = [];
    private m_animatedExtrusionRatio: number = AnimatedExtrusionHandler.DEFAULT_RATIO_MAX;
    private m_animatedExtrusionState: AnimatedExtrusionState = AnimatedExtrusionState.None;
    private m_animatedExtrusionStartTime: number | undefined = undefined;
    private m_mapView: MapView;
    private m_animatedExtrusionHandler: AnimatedExtrusionHandler;

    constructor(
        private m_tile: Tile,
        extrudedObjects: Array<{ object: THREE.Object3D; materialFeature: boolean }>,
        private m_animatedExtrusionDuration: number
    ) {
        this.m_mapView = m_tile.mapView;
        this.m_animatedExtrusionHandler = this.m_mapView.animatedExtrusionHandler;

        extrudedObjects.forEach(extrudedObject => {
            if (extrudedObject.materialFeature) {
                ExtrusionFeature.addRenderHelper(extrudedObject.object);
            }
            this.m_extrudedObjects.push(extrudedObject.object);
        });

        if (this.m_animatedExtrusionHandler.shouldAnimate(this.m_tile)) {
            this.startExtrusionAnimation();
        }
    }

    /**
     * Set an extrusion ratio value for the materials [[MapMeshBasicMaterial]]
     * and [[EdgeMaterial]]. Controlled by [[AnimatedExtrusionHandler]]
     * for extrusion animation effect.
     */
    set extrusionRatio(value: number) {
        this.m_animatedExtrusionRatio = value;

        this.m_extrudedObjects.forEach(object => {
            const material = (object as (THREE.Mesh | THREE.LineSegments))
                .material as ExtrusionFeature;
            material.extrusionRatio = this.m_animatedExtrusionRatio;
        });
    }

    /**
     * Return extrusion ratio used for an extrusion animation effect.
     */
    get extrusionRatio(): number {
        return this.m_animatedExtrusionRatio;
    }

    /**
     * Return [[Tile]] that connected to [[AnimatedExtrusionTileHandler]]
     */
    get tile(): Tile {
        return this.m_tile;
    }

    /**
     * Cancel animation and remove from [[AnimatedExtrusionHandler]]
     */
    dispose() {
        this.stopExtrusionAnimation();
        this.m_animatedExtrusionHandler.remove(this);
    }

    /**
     * Start / Stop extrusion animation
     */
    zoomLevelChanged(zoomLevel: number) {
        // TODO: UPDATE
        // console.log(this.m_tile.isVisible);
        // if (
        //     zoomLevel >= this.m_animatedExtrusionZoomLevel &&
        //     this.m_animatedExtrusionZoomedIn === false
        // ) {
        //     this.m_animatedExtrusionZoomedIn = true;
        //     this.startExtrusionAnimation();
        // }

        // if (
        //     zoomLevel < this.m_animatedExtrusionZoomLevel &&
        //     this.m_animatedExtrusionZoomedIn === true
        // ) {
        //     this.m_animatedExtrusionZoomedIn = false;

        //     this.extrusionRatio = AnimatedExtrusionHandler.DEFAULT_RATIO_MIN;
        //     this.m_animatedExtrusionState = AnimatedExtrusionState.None;

        //     this.m_tile.dataSource.requestUpdate();

        //     this.stopExtrusionAnimation();
        // }

        if (this.m_animatedExtrusionHandler.shouldAnimate(this.m_tile)) {
            this.startExtrusionAnimation();
        }
    }

    private startExtrusionAnimation(): void {
        this.m_animatedExtrusionStartTime = undefined;
        this.animateExtrusion();
        this.m_animatedExtrusionHandler.tileExtruded(this.m_tile.tileKey);
        this.m_mapView.addEventListener(MapViewEventNames.AfterRender, this.animateExtrusion);
    }

    private stopExtrusionAnimation(): void {
        if (this.m_extrudedObjects.length > 0) {
            this.m_mapView.removeEventListener(
                MapViewEventNames.AfterRender,
                this.animateExtrusion
            );
        }
    }

    private animateExtrusion = (event?: RenderEvent) => {
        if (this.m_animatedExtrusionState === AnimatedExtrusionState.Started) {
            this.m_animatedExtrusionState = AnimatedExtrusionState.Playing;
        }
        if (this.m_animatedExtrusionState === AnimatedExtrusionState.Finished) {
            return;
        }

        const currentTime = (event && event.time) || 0;
        if (
            this.m_animatedExtrusionStartTime === undefined ||
            this.m_animatedExtrusionStartTime <= 0
        ) {
            this.m_animatedExtrusionStartTime = currentTime;
        }

        const timeProgress = Math.min(
            currentTime - this.m_animatedExtrusionStartTime,
            this.m_animatedExtrusionDuration
        );

        this.extrusionRatio = MathUtils.easeInOutCubic(
            AnimatedExtrusionHandler.DEFAULT_RATIO_MIN,
            AnimatedExtrusionHandler.DEFAULT_RATIO_MAX,
            timeProgress / this.m_animatedExtrusionDuration
        );

        if (timeProgress >= this.m_animatedExtrusionDuration) {
            this.stopExtrusionAnimation();
            this.m_animatedExtrusionState = AnimatedExtrusionState.Finished;
            this.m_animatedExtrusionStartTime = undefined;
        }
        {
            this.m_tile.dataSource.requestUpdate();
        }
    };
}
