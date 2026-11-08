"""Build the Trollskull Manor GLBs in Blender from the JSON written by derive.ts.

Run headless:
    blender -b --factory-startup -P tools/interior/build.py -- <scene.json> <out dir> <file.blend>

Objects the owner adds by hand under the collection `Manual/<floor id>` survive every rebuild and
are exported with that floor. Everything under `Generado` is rebuilt from data each time.
"""
import json
import math
import os
import sys

import bpy

GENERATED = 'Generado'
MANUAL = 'Manual'
CYLINDER_SEGMENTS = 16
# Shapes are merged into one mesh per category, so the engine draws a floor in a few calls.
CATEGORIES = (
    ('suelo-', 'suelos'),
    ('muro-', 'muros'),
    ('dintel-', 'vanos'),
    ('alfeizar-', 'vanos'),
    ('vidrio-', 'vidrios'),
    ('escalera-', 'escaleras'),
    ('escala-', 'escaleras'),
    ('portilla-', 'escaleras'),
    ('poste-', 'postes'),
)
SLIDE_WIDTH = 0.7
SLIDE_WALL = 0.28
SLIDE_DIP = 0.08
GAMMA = 2.2
HEX_BASE = 16
CHANNEL_MAX = 255
RGB_OFFSETS = (0, 2, 4)
NURBS_ORDER = 3
# Corner indices of a box (x, y, z each low or high) wound into its six outward faces.
BOX_FACES = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))


def to_blender(point):
    """glTF axes (x east, y up, z south) to Blender axes (x east, y north, z up)."""
    x, y, z = point
    return (x, -z, y)


def linear_rgba(color, alpha):
    value = color.lstrip('#')
    channels = [int(value[i:i + 2], HEX_BASE) / CHANNEL_MAX for i in RGB_OFFSETS]
    return (*[channel ** GAMMA for channel in channels], alpha)


def principled(material):
    """The material's Principled BSDF, created and wired to the output if it is missing."""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
    if shader:
        return shader
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    output = next((node for node in nodes if node.type == 'OUTPUT_MATERIAL'), None)
    output = output or nodes.new('ShaderNodeOutputMaterial')
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    return shader


def make_materials(specs):
    """One Principled material per spec name. O(materials)."""
    materials = {}
    for name, spec in specs.items():
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        shader = principled(material)
        shader.inputs['Base Color'].default_value = linear_rgba(spec['color'], 1)
        shader.inputs['Roughness'].default_value = spec['roughness']
        shader.inputs['Metallic'].default_value = spec['metallic']
        shader.inputs['Alpha'].default_value = spec['alpha']
        material.surface_render_method = 'BLENDED' if spec['alpha'] < 1 else 'DITHERED'
        materials[name] = material
    return materials


def box_mesh(shape):
    sx, sy, sz = (value / 2 for value in shape['size'])
    corners = [(x, y, z) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
    return [to_blender(corner) for corner in corners], list(BOX_FACES)


def cylinder_mesh(shape):
    radius, half, count = shape['radius'], shape['height'] / 2, CYLINDER_SEGMENTS
    ring = [(radius * math.cos(2 * math.pi * i / count), radius * math.sin(2 * math.pi * i / count))
            for i in range(count)]
    vertices = [to_blender((x, y, z)) for y in (-half, half) for x, z in ring]
    # Wound so every normal points outward: the ring turns from +x toward +z (south).
    sides = [(count + i, count + (i + 1) % count, (i + 1) % count, i) for i in range(count)]
    caps = [tuple(range(count)), tuple(reversed(range(count, 2 * count)))]
    return vertices, sides + caps


MESHES = {'box': box_mesh, 'cylinder': cylinder_mesh}


def placed(shape):
    """The shape's vertices in Blender world space, and its faces."""
    vertices, faces = MESHES[shape['kind']](shape)
    cx, cy, cz = to_blender(shape['center'])
    return [(x + cx, y + cy, z + cz) for x, y, z in vertices], faces


def merged_object(name, shapes, materials, collection):
    """One mesh holding every shape, with a material slot per material used. O(vertices)."""
    vertices, faces, face_slots, slots = [], [], [], []
    for shape in shapes:
        if shape['material'] not in slots:
            slots.append(shape['material'])
        world, shape_faces = placed(shape)
        offset = len(vertices)
        vertices.extend(world)
        faces.extend(tuple(index + offset for index in face) for face in shape_faces)
        face_slots.extend([slots.index(shape['material'])] * len(shape_faces))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    for slot in slots:
        mesh.materials.append(materials[slot])
    mesh.polygons.foreach_set('material_index', face_slots)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def category_of(name):
    matches = (category for prefix, category in CATEGORIES if name.startswith(prefix))
    return next(matches, 'detalles')


def child_collection(name, parent):
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    return collection


def build_group(group_name, shapes, materials, parent):
    """A collection with one merged mesh per category of shape. Returns its objects."""
    collection = child_collection(group_name, parent)
    by_category = {}
    for shape in shapes:
        by_category.setdefault(category_of(shape['name']), []).append(shape)
    return [merged_object(f'{group_name}-{category}', group, materials, collection)
            for category, group in by_category.items()]


def slide_profile():
    """A U-shaped trough section, open on top, used as the bevel of the slide curve."""
    curve = bpy.data.curves.new('perfil-tobogan', 'CURVE')
    spline = curve.splines.new('POLY')
    half = SLIDE_WIDTH / 2
    points = [(-half, SLIDE_WALL), (-half, 0), (0, -SLIDE_DIP), (half, 0), (half, SLIDE_WALL)]
    spline.points.add(len(points) - 1)
    for point, (x, y) in zip(spline.points, points):
        point.co = (x, y, 0, 1)
    return bpy.data.objects.new('perfil-tobogan', curve)


def slide_curve(slide, profile):
    curve = bpy.data.curves.new(f"{slide['name']}-curva", 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_mode = 'OBJECT'
    curve.bevel_object = profile
    spline = curve.splines.new('NURBS')
    spline.points.add(len(slide['points']) - 1)
    for point, position in zip(spline.points, slide['points']):
        point.co = (*to_blender(position), 1)
    spline.use_endpoint_u = True
    spline.order_u = NURBS_ORDER
    return curve


def build_slide(slide, materials, parent):
    """The trough swept along the slide path, baked to a mesh, plus its posts."""
    collection = child_collection('tobogan', parent)
    profile = slide_profile()
    source = bpy.data.objects.new(f"{slide['name']}-curva", slide_curve(slide, profile))
    for obj in (profile, source):
        collection.objects.link(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(depsgraph))
    mesh.name = slide['name']
    mesh.materials.append(materials['slide'])
    trough = bpy.data.objects.new(slide['name'], mesh)
    collection.objects.link(trough)
    for obj in (source, profile):
        bpy.data.objects.remove(obj)
    return [trough, merged_object('tobogan-postes', slide['posts'], materials, collection)]


def export(objects, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True)


def manual_collection_objects():
    manual = bpy.data.collections.get(MANUAL)
    return list(manual.all_objects) if manual else []


def manual_objects(floor_id):
    """Visible hand-made objects for one floor; hidden ones are reported, not exported."""
    manual = bpy.data.collections.get(MANUAL)
    floor = manual.children.get(f'{MANUAL}/{floor_id}') if manual else None
    objects = list(floor.all_objects) if floor else []
    hidden = [obj.name for obj in objects if obj.hide_get() or obj.hide_render]
    if hidden:
        print(f'WARNING {floor_id}: hidden manual objects not exported: {", ".join(hidden)}')
    return [obj for obj in objects if obj.name not in hidden]


def purge_orphans():
    """Remove meshes and curves no object uses, so rebuilt meshes keep their exact names."""
    for blocks in (bpy.data.meshes, bpy.data.curves):
        for block in [block for block in blocks if block.users == 0]:
            blocks.remove(block)


def reset_generated():
    """Drop what the last build generated; leave the Manual collection untouched."""
    old = bpy.data.collections.get(GENERATED)
    kept = set(manual_collection_objects())
    if old:
        for obj in list(old.all_objects):
            if obj in kept:
                continue  # also linked under Manual: the owner's object, never deleted here
            bpy.data.objects.remove(obj, do_unlink=True)
        for child in list(old.children_recursive):
            bpy.data.collections.remove(child)
        bpy.data.collections.remove(old)
    purge_orphans()
    return child_collection(GENERATED, bpy.context.scene.collection)


def open_or_new(blend_path):
    if os.path.exists(blend_path):
        bpy.ops.wm.open_mainfile(filepath=blend_path)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)


def build_props(props, materials, generated, out_dir):
    for prop in props:
        collection = child_collection(f"mueble-{prop['kind']}", generated)
        piece = merged_object(prop['kind'], prop['shapes'], materials, collection)
        export([piece], os.path.join(out_dir, 'props', f"{prop['kind']}.glb"))


def write_manifest(scene, out_dir):
    """Records which scene the exported models came from, so a test can catch stale models."""
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump({'plan': scene['plan'], 'scene_sha256': scene['hash']}, handle, indent=2)
        handle.write('\n')


def main():
    scene_path, out_dir, blend_path = sys.argv[sys.argv.index('--') + 1:][:3]
    with open(scene_path, encoding='utf-8') as handle:
        scene = json.load(handle)
    open_or_new(blend_path)
    generated = reset_generated()
    materials = make_materials(scene['materials'])
    for floor in scene['floors']:
        objects = build_group(floor['id'], floor['shapes'], materials, generated)
        export(objects + manual_objects(floor['id']), os.path.join(out_dir, f"{floor['id']}.glb"))
    if scene['slide']:
        slide = build_slide(scene['slide'], materials, generated)
        export(slide, os.path.join(out_dir, 'tobogan.glb'))
    build_props(scene['props'], materials, generated, out_dir)
    write_manifest(scene, out_dir)
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"BUILT {len(scene['floors'])} floors and {len(scene['props'])} props into {out_dir}")


main()
