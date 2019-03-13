/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

export default {
    extrusion_pars_vertex: `
uniform float extrusionRatio;
`,
    extrusion_vertex: `
transformed.z = transformed.z * extrusionRatio;
`
};
