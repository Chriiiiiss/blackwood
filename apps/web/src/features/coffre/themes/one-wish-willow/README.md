# One Wish Willow model and fallback

The composer and confirmation reuse `createWillowModel.ts` from the retained
ENG-46 Three.js study: an equilateral triangular prism with canvas textures for
the vector print, message and ends. The shared preview viewer owns the camera,
lighting and direct pointer/keyboard interaction; models do not import the viewer. Model
replacement reuses its WebGL context and disposes obsolete geometry, materials
and textures. Rendering occurs on changes, without an animation loop.

The study's provisional message capacity is not introduced as a new product
limit. Printed text fits the complete API-valid message on one face without
pagination; confirmation also exposes readable HTML text. The SVG component
remains the explicitly labeled WebGL fallback and the public-list reference.
The demo chest, editor, scenery, GLB import and TV renderer are not shipped.
Final visual approval remains ENG-46. This is the reconstructed study model,
not the undownloaded Sketchfab asset.

The native SVG print is traced from the community template by
**TiraRemy / u/MrThec123**:
https://www.reddit.com/r/obsessionmovie/comments/1uq4tek/999_accurate_one_wish_willow_box_template/

The print is derived artwork, not an original illustration. Caprasimo Regular
is self-hosted under the accompanying SIL OFL 1.1 license (`caprasimo-OFL.txt`).
The triangular prism reference uses the existing shared-vertex affine geometry;
messages are rendered as React text, without HTML injection or baked photo frames.
