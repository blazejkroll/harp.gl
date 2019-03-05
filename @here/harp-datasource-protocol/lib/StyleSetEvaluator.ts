/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    InterpolatedProperty,
    InterpolationMode,
    isInterpolatedProperty,
    Technique
} from "./Techniques";

import {
    InterpolatedPropertyDefinition,
    isInterpolatedPropertyDefinition,
    MaybeInterpolatedProperty,
    Style,
    StyleSet
} from "./Theme";

import { LoggerManager, MathUtils } from "@here/harp-utils";

import { Expr, MapEnv } from "./Expr";

import { CubicInterpolant, DiscreteInterpolant, LinearInterpolant } from "three";

export const logger = LoggerManager.instance.create("Theme");

const interpolants = [DiscreteInterpolant, LinearInterpolant, CubicInterpolant];

interface StylePrivate {
    /**
     * Optimization: Lazy creation and storage of expression in a style object.
     */
    _whenExpr: Expr;

    /**
     * Automatically assigned default render order. Automatic renderOrders are in ascending order
     * from the top of the theme to the bottom. Only assigned if renderOrder is not used.
     * @hidden
     */
    _renderOrderAuto?: number;

    /**
     * Optimization: Index into table in StyleSetEvaluator.
     * @hidden
     */
    _index?: number;
}

/**
 * Get the value of the specified property at the given zoom level. Handles [[InterpolatedProperty]]
 * instances as well as future interpolated values.
 *
 * @param property Property of a technique.
 * @param level Display level the property should be rendered at.
 */
export function getPropertyValue<T>(
    property: InterpolatedProperty<T> | MaybeInterpolatedProperty<T> | undefined,
    level: number
): T | undefined {
    if (!isInterpolatedProperty(property)) {
        if (isInterpolatedPropertyDefinition(property)) {
            throw new Error("Invalid property definition");
        }
        return property;
    } else {
        const nChannels = property.values.length / property.zoomLevels.length;
        const isMultiChannel = nChannels > 1;
        const interpolant = new interpolants[property.interpolationMode](
            property.zoomLevels,
            property.values,
            nChannels
        );
        interpolant.evaluate(level);
        let result = isMultiChannel ? "#" : 0;
        // tslint:disable:no-bitwise
        for (const value of interpolant.resultBuffer) {
            const val = isMultiChannel
                ? ("0" + ((MathUtils.clamp(value, 0, 1) * 255) | 0).toString(16)).slice(-2)
                : value;
            result += val;
        }
        // tslint:disable:bitwise
        return (result as unknown) as T;
    }
}

/**
 * Combine data from datasource and apply the rules from a specified theme to show it on the map.
 */
export class StyleSetEvaluator {
    private readonly m_renderOrderBiasGroups: Map<string, number>;
    private readonly m_techniques: Technique[];

    constructor(readonly styleSet: StyleSet, readonly validate?: boolean) {
        this.m_renderOrderBiasGroups = new Map<string, number>();
        this.m_techniques = new Array<Technique>();
        let techniqueRenderOrder = 0;
        const computeDefaultRenderOrder = (style: Style): void => {
            if (style.renderOrderBiasGroup !== undefined) {
                const renderOrderBiasGroupOrder = style.renderOrderBiasGroup
                    ? this.m_renderOrderBiasGroups.get(style.renderOrderBiasGroup)
                    : undefined;
                if (
                    style.renderOrderBiasRange !== undefined &&
                    renderOrderBiasGroupOrder === undefined
                ) {
                    if (style.renderOrder !== undefined) {
                        logger.warn(
                            "WARN: style.renderOrder will be overridden if " +
                                "renderOrderBiasGroup is set:",
                            style
                        );
                    }
                    const [minRange, maxRange] = style.renderOrderBiasRange;
                    style.renderOrder =
                        minRange < 0
                            ? techniqueRenderOrder + Math.abs(minRange)
                            : techniqueRenderOrder;
                    techniqueRenderOrder += Math.abs(minRange) + maxRange;
                    if (style.renderOrderBiasGroup) {
                        this.m_renderOrderBiasGroups.set(
                            style.renderOrderBiasGroup,
                            style.renderOrder
                        );
                    }
                    techniqueRenderOrder++;
                } else if (renderOrderBiasGroupOrder) {
                    if (style.renderOrder !== undefined) {
                        logger.warn(
                            "WARN: style.renderOrder will be overridden if " +
                                "renderOrderBiasGroup is set:",
                            style
                        );
                    }
                    style.renderOrder = renderOrderBiasGroupOrder;
                }
            }
            // search through child styles
            if (style.styles !== undefined) {
                // TODO: Do proper validation (somewhere else). See HARP-732
                if (this.validate) {
                    if (!Array.isArray(style.styles)) {
                        logger.error("ERROR: style.styles must be an Array:", style);
                    }
                }
                for (const currStyle of style.styles) {
                    computeDefaultRenderOrder(currStyle);
                }
            } else {
                if (style.technique !== undefined) {
                    if (style.attr !== undefined && style.attr.renderOrder === undefined) {
                        style.attr._renderOrderAuto = techniqueRenderOrder++;
                    }
                }
            }
        };
        for (const style of styleSet) {
            computeDefaultRenderOrder(style);
        }
    }
    /**
     * Find all techniques that fit the current objects' environment.
     * *The techniques in the resulting array may not be modified* since they are being reused for
     * identical objects.
     *
     * @param env The objects environment, i.e. the attributes that are relevant for its
     * representation.
     */
    getMatchingTechniques(env: MapEnv): Technique[] {
        const result: Technique[] = [];
        const styleStack = new Array<Style>();
        for (const currStyle of this.styleSet) {
            if (this.validate && styleStack.length !== 0) {
                throw new Error("Internal error: style stack cleanup failed");
            }
            if (this.processStyle(env, styleStack, currStyle, result)) {
                break;
            }
        }
        return result;
    }
    /**
     * Add a technique to the current array of techniques. Add its index to the style, so next time
     * the technique can be found directly from this index.
     *
     * @param style Style that defines technique
     * @param technique Technique to add
     */
    private checkAddTechnique(style: Style, technique: Technique): number {
        let index = style._index === undefined ? -1 : style._index;
        if (index < 0) {
            technique._index = index = this.m_techniques.length;
            this.m_techniques.push(technique);
            style._index = index;
        } else {
            technique._index = index;
        }
        return index;
    }
    /**
     * Get the (current) array of techniques that have been created during decoding.
     */
    get techniques(): Technique[] {
        return this.m_techniques;
    }
    /**
     * Shorten the style object for debug log. Remove special strings (starting with "_") as well
     * as the sub-styles of style groups.
     *
     * @param key Key in object
     * @param value value in object
     */
    private cleanupStyle(key: string, value: any): any {
        // Filtering out properties
        if (key === "styles") {
            return "[...]";
        }
        if (key.startsWith("_")) {
            return undefined;
        }
        return value;
    }
    /**
     * Process a style (and its sub-styles) hierarchically to look for the technique that fits the
     * current objects' environment. The attributes of the styles are assembled to create a unique
     * technique for every object.
     *
     * @param env The objects environment, i.e. the attributes that are relevant for its
     *            representation.
     * @param styleStack Stack of styles containing the hierarchy of styles up to this point.
     * @param style Current style (could also be top of stack).
     * @param result The array of resulting techniques. There may be more than one technique per
     *               object, resulting in multiple graphical objects for representation.
     * @returns `true` if style has been found and processing is finished. `false` if not found, or
     *          more than one technique should be applied.
     */
    private processStyle(
        env: MapEnv,
        styleStack: Style[],
        style: Style & Partial<StylePrivate>,
        result: Technique[]
    ): boolean {
        if (style.when !== undefined) {
            // optimization: Lazy evaluation of when-expression
            if (style._whenExpr === undefined) {
                style._whenExpr = Expr.parse(style.when);
            }
            if (!style._whenExpr.evaluate(env)) {
                return false;
            }
        }
        // search through sub-styles
        if (style.styles !== undefined) {
            if (style.debug) {
                logger.log(
                    "\n======== style group =========\nenv:",
                    JSON.stringify(env.unmap(), undefined, 2),
                    "\nstyle group:",
                    JSON.stringify(style, this.cleanupStyle, 2)
                );
            }
            styleStack.push(style);
            // TODO: Do proper validation (somewhere else). See HARP-732
            if (this.validate) {
                if (!Array.isArray(style.styles)) {
                    logger.error("ERROR: style.styles must be an Array:", style);
                    styleStack.pop();
                    return false;
                }
            }
            for (const currStyle of style.styles) {
                if (this.processStyle(env, styleStack, currStyle, result)) {
                    styleStack.pop();
                    return true;
                }
            }
            styleStack.pop();
        } else {
            // we found a technique!
            if (style.technique !== undefined) {
                // check if we already assembled the technique for exactly this style. If we have,
                // we return the preassembled technique object. Otherwise we assemble the technique
                // from all parent styles' attributes and the current stales' attributes, and add it
                // to the cached techniques.
                if (style._index === undefined) {
                    const technique = {} as any;
                    technique.name = style.technique;
                    const addAttributes = (currStyle: Style) => {
                        if (currStyle.renderOrder !== undefined) {
                            technique.renderOrder = currStyle.renderOrder;
                        }
                        if (currStyle.transient !== undefined) {
                            technique.transient = currStyle.transient;
                        }
                        if (currStyle.renderOrderBiasProperty !== undefined) {
                            technique.renderOrderBiasProperty = currStyle.renderOrderBiasProperty;
                        }
                        if (currStyle.labelProperty !== undefined) {
                            technique.label = currStyle.labelProperty;
                        }
                        if (currStyle.renderOrderBiasRange !== undefined) {
                            technique.renderOrderBiasRange = currStyle.renderOrderBiasRange;
                        }
                        if (currStyle.renderOrderBiasGroup !== undefined) {
                            technique.renderOrderBiasGroup = currStyle.renderOrderBiasGroup;
                        }
                        if (currStyle.attr !== undefined) {
                            Object.getOwnPropertyNames(currStyle.attr).forEach(property => {
                                // check for valid attr keys
                                // TODO: Do proper validation (somewhere else). See HARP-732
                                if (this.validate) {
                                    if (property === "technique") {
                                        logger.warn(
                                            "WARNING: technique defined in attr " + "(deprecated):",
                                            currStyle
                                        );
                                    } else if (property === "renderOrder") {
                                        logger.warn(
                                            "WARNING: renderOrder defined in attr " +
                                                "(deprecated):",
                                            currStyle
                                        );
                                    }
                                }
                                if (currStyle.attr !== undefined) {
                                    const prop = (currStyle.attr as any)[property];
                                    if (isInterpolatedPropertyDefinition(prop)) {
                                        switch (typeof prop.values[0]) {
                                            default:
                                            case "number":
                                                technique[property] = createInterpolatedProperty(
                                                    prop as InterpolatedPropertyDefinition<number>
                                                );
                                                break;
                                            case "boolean":
                                                technique[property] = createInterpolatedProperty(
                                                    prop as InterpolatedPropertyDefinition<boolean>
                                                );
                                                break;
                                            case "string":
                                                technique[property] = createInterpolatedProperty(
                                                    prop as InterpolatedPropertyDefinition<string>
                                                );
                                                break;
                                        }
                                    } else {
                                        technique[property] = prop;
                                    }
                                }
                            });
                        }
                    };
                    for (const currStyle of styleStack) {
                        addAttributes(currStyle);
                    }
                    addAttributes(style);
                    this.checkAddTechnique(style, technique);
                    result.push(technique);
                    if (style.debug) {
                        logger.log(
                            "\n======== style w/ technique =========\nenv:",
                            JSON.stringify(env.unmap(), undefined, 2),
                            "\nstyle:",
                            JSON.stringify(style, this.cleanupStyle, 2),
                            "\ntechnique:",
                            JSON.stringify(technique, this.cleanupStyle, 2)
                        );
                    }
                } else {
                    result.push(this.m_techniques[style._index]);
                }
                // stop processing if "final" is set
                return style.final === true;
            } else if (this.validate) {
                logger.warn(
                    "WARNING: No technique defined in style. Either sub-styles or a " +
                        "technique must be defined:",
                    JSON.stringify(style)
                );
            }
        }
        return false;
    }
}

function removeDuplicatePropertyValues<T>(p: InterpolatedPropertyDefinition<T>) {
    for (let i = 0; i < p.values.length; ++i) {
        const firstIdx = p.zoomLevels.findIndex((a: number) => {
            return a === p.zoomLevels[i];
        });
        if (firstIdx !== i) {
            p.zoomLevels.splice(--i, 1);
            p.values.splice(--i, 1);
        }
    }
}

function createInterpolatedProperty<T>(prop: InterpolatedPropertyDefinition<T>) {
    removeDuplicatePropertyValues(prop);
    const propKeys = new Float32Array(prop.zoomLevels);
    let propValues;
    switch (typeof prop.values[0]) {
        default:
        case "number":
            propValues = new Float32Array((prop.values as any[]) as number[]);
            return {
                interpolationMode:
                    prop.interpolation !== undefined
                        ? InterpolationMode[prop.interpolation]
                        : InterpolationMode.Discrete,
                zoomLevels: propKeys,
                values: propValues
            };
        case "boolean":
            propValues = new Float32Array(prop.values.length);
            for (let i = 0; i < prop.values.length; ++i) {
                propValues[i] = ((prop.values[i] as unknown) as boolean) ? 1 : 0;
            }
            return {
                interpolationMode: InterpolationMode.Discrete,
                zoomLevels: propKeys,
                values: propValues
            };
        case "string":
            propValues = new Float32Array(prop.values.length * 3);
            for (let i = 0; i < prop.values.length; ++i) {
                const value = +((prop.values[i] as unknown) as string).replace("#", "0x");
                // tslint:disable:no-bitwise
                const channels = [
                    ((value >> 16) & 255) / 255,
                    ((value >> 8) & 255) / 255,
                    ((value >> 0) & 255) / 255
                ];
                // tslint:disable:bitwise
                for (let j = 0; j < prop.values.length * 3; ++j) {
                    propValues[i * 3 + j] = channels[j];
                }
            }
            return {
                interpolationMode:
                    prop.interpolation !== undefined
                        ? InterpolationMode[prop.interpolation]
                        : InterpolationMode.Discrete,
                zoomLevels: propKeys,
                values: propValues
            };
    }
}
