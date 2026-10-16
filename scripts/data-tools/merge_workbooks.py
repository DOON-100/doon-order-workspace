"""Append artifact-authored worksheets without round-tripping original sheets.

Usage:
    python merge_workbooks.py ORIGINAL.xlsx EXTRA.xlsx OUTPUT.xlsx

All EXTRA worksheets are appended unless --omit-sheet names a temporary source
sheet. When omitted, that sheet must also exist in ORIGINAL so its formula
references resolve to the identically named, unchanged original sheet.
Only package registration XML, styles.xml, and app.xml may change in ORIGINAL.
The original worksheet XML, worksheet relationships, tables, external links,
shared strings, theme, calculation chain, and every other original part are
checked byte-for-byte after writing. Verification is written beside OUTPUT as
OUTPUT.merge-validation.json. The input files can never be output destinations.

The new sheets must use the same date system. Ordinary cells, formulas, cached
values, shared strings, formatting, conditional formatting, tables, external
hyperlinks, and local defined names are supported. Unsupported dependent parts
fail before writing instead of being silently omitted. Standard library only.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.sax.saxutils import quoteattr


SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
DOCREL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS = {"s": SS, "r": DOCREL, "pr": REL, "ct": CT, "ep": EP, "vt": VT}
WORKBOOK = "xl/workbook.xml"
WORKBOOK_RELS = "xl/_rels/workbook.xml.rels"
STYLE_ORDER = ["numFmts", "fonts", "fills", "borders", "cellStyleXfs",
               "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst"]
WORKBOOK_ORDER = ["fileVersion", "fileSharing", "workbookPr", "workbookProtection",
                  "bookViews", "sheets", "functionGroups", "externalReferences",
                  "definedNames", "calcPr", "oleSize", "customWorkbookViews",
                  "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing",
                  "fileRecoveryPr", "webPublishObjects", "extLst"]


def q(local: str, ns: str = SS) -> str:
    return "{" + ns + "}" + local


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse(data: bytes) -> ET.Element:
    return ET.fromstring(data)


def namespaces(data: bytes) -> dict[str, str]:
    # Preserve namespace declarations used in mc:Ignorable attribute values.
    result = {}
    for _, item in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
        prefix, uri = item
        if prefix not in result:
            result[prefix] = uri
    return result


def serialize(root: ET.Element, template: bytes | None = None) -> bytes:
    mapping = namespaces(template) if template else {}
    default_ns = root.tag[1:].split("}", 1)[0] if root.tag.startswith("{") else ""
    mapping[""] = default_ns
    for prefix, uri in mapping.items():
        if not re.fullmatch(r"ns\d+", prefix) and prefix != "xml":
            ET.register_namespace(prefix, uri)
    ET.register_namespace("r", DOCREL)
    ET.register_namespace("vt", VT)
    result = ET.tostring(root, encoding="unicode", xml_declaration=False)
    end = result.index(">")
    opening = result[:end]
    declarations = dict((p or "", u) for p, u in re.findall(
        r'xmlns(?::([^\s=]+))?="([^"]+)"', opening))
    additions = []
    for prefix, uri in mapping.items():
        if prefix == "xml" or not uri:
            continue
        if prefix in declarations:
            if declarations[prefix] != uri:
                raise ValueError(f"Namespace collision during serialization: {prefix}")
            continue
        name = "xmlns" + (":" + prefix if prefix else "")
        additions.append(" " + name + "=" + quoteattr(uri))
    if additions:
        insertion = end - 1 if result[end - 1] == "/" else end
        result = result[:insertion] + "".join(additions) + result[insertion:]
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + result).encode("utf-8")


def child(root: ET.Element, tag: str, order=STYLE_ORDER) -> ET.Element:
    found = root.find(q(tag))
    if found is not None:
        return found
    found = ET.Element(q(tag))
    rank = order.index(tag)
    for i, element in enumerate(root):
        if local(element.tag) in order and order.index(local(element.tag)) > rank:
            root.insert(i, found)
            return found
    root.append(found)
    return found


def rels_path(part: str) -> str:
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")


def resolve(part: str, target: str) -> str:
    value = target.lstrip("/") if target.startswith("/") else posixpath.normpath(
        posixpath.join(posixpath.dirname(part), target))
    if value.startswith("../") or value.startswith("/"):
        raise ValueError(f"Invalid relationship target: {part}: {target}")
    return value


def relative(source: str, target: str) -> str:
    return posixpath.relpath(target, posixpath.dirname(source))


def relationships(parts: dict[str, bytes], owner: str) -> dict[str, ET.Element]:
    filename = rels_path(owner)
    return {r.get("Id"): r for r in parse(parts[filename])} if filename in parts else {}


def workbook_sheets(parts: dict[str, bytes]) -> tuple[ET.Element, list[dict]]:
    root = parse(parts[WORKBOOK])
    rels = relationships(parts, WORKBOOK)
    rows = []
    for index, sheet in enumerate(root.find(q("sheets"))):
        rid = sheet.get(q("id", DOCREL))
        relationship = rels[rid]
        if not relationship.get("Type", "").endswith("/worksheet"):
            raise ValueError(f"Unsupported sheet type: {sheet.get('name')}")
        rows.append({"index": index, "element": sheet, "name": sheet.get("name"),
                     "path": resolve(WORKBOOK, relationship.get("Target"))})
    return root, rows


def date1904(workbook: ET.Element) -> bool:
    props = workbook.find(q("workbookPr"))
    return props is not None and props.get("date1904", "0").lower() in ("1", "true")


def theme_colors(parts: dict[str, bytes]) -> dict[int, str]:
    relation = next((r for r in relationships(parts, WORKBOOK).values()
                     if r.get("Type", "").endswith("/theme")), None)
    if relation is None:
        return {}
    theme = parse(parts[resolve(WORKBOOK, relation.get("Target"))])
    scheme = theme.find(".//" + q("clrScheme", A))
    names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3",
             "accent4", "accent5", "accent6", "hlink", "folHlink"]
    result = {}
    if scheme is not None:
        for i, name in enumerate(names):
            e = scheme.find(q(name, A))
            if e is not None and len(e):
                color = e[0].get("lastClr") or e[0].get("val")
                if color and re.fullmatch(r"[0-9A-Fa-f]{6}", color):
                    result[i] = "FF" + color.upper()
    return result


def freeze_colors(element: ET.Element, palette: dict[int, str]):
    for entry in element.iter():
        if "theme" in entry.attrib:
            index = int(entry.attrib.pop("theme"))
            if index not in palette:
                raise ValueError(f"New style uses theme color {index}, absent from extra theme")
            entry.set("rgb", palette[index])


def rewrite_formula(text: str | None, replacements: dict[str, str]) -> str | None:
    if not text or not replacements:
        return text
    # Excel strings in double quotes are not table references.
    tokens = re.split(r'("(?:[^"]|"")*")', text)
    for i in range(0, len(tokens), 2):
        for old, new in replacements.items():
            tokens[i] = re.sub(r"(?<![\w.])" + re.escape(old) + r"(?=\[)",
                               lambda _: new, tokens[i], flags=re.IGNORECASE)
    return "".join(tokens)


def merge_styles(original: bytes, extra: bytes, palette: dict[int, str]):
    dst, src = parse(original), parse(extra)
    maps = {}
    # Custom formats occupy the application-defined ID range, not list positions.
    target_num = child(dst, "numFmts")
    used_num = {int(e.get("numFmtId")) for e in target_num}
    for xf in dst.iter():
        if "numFmtId" in xf.attrib:
            used_num.add(int(xf.get("numFmtId")))
    next_num = max(used_num | {163}) + 1
    num_map = {i: i for i in range(164)}
    src_num = src.find(q("numFmts"))
    for e in ([] if src_num is None else src_num):
        copied = copy.deepcopy(e)
        old = int(copied.get("numFmtId"))
        existing = next((n for n in target_num if n.get("formatCode") == e.get("formatCode")), None)
        if existing is not None:
            num_map[old] = int(existing.get("numFmtId"))
        else:
            num_map[old] = next_num
            copied.set("numFmtId", str(next_num))
            next_num += 1
            target_num.append(copied)
    target_num.set("count", str(len(target_num)))
    maps["numFmtId"] = num_map

    for collection, attr in [("fonts", "fontId"), ("fills", "fillId"), ("borders", "borderId")]:
        dest = child(dst, collection)
        source = src.find(q(collection))
        mapping = {}
        for i, element in enumerate([] if source is None else source):
            copied = copy.deepcopy(element)
            freeze_colors(copied, palette)
            # The explicit name is retained rather than taking the original theme's font.
            if collection == "fonts":
                for scheme in list(copied.findall(q("scheme"))):
                    copied.remove(scheme)
            mapping[i] = len(dest)
            dest.append(copied)
        dest.set("count", str(len(dest)))
        maps[attr] = mapping

    for collection, key in [("cellStyleXfs", "xfId"), ("cellXfs", "s")]:
        dest = child(dst, collection)
        source = src.find(q(collection))
        mapping = {}
        for i, element in enumerate([] if source is None else source):
            copied = copy.deepcopy(element)
            for attr in ("numFmtId", "fontId", "fillId", "borderId"):
                if attr not in copied.attrib:
                    copied.set(attr, "0")
            if collection == "cellXfs" and "xfId" not in copied.attrib and maps.get("xfId"):
                copied.set("xfId", "0")
            for attr in ("numFmtId", "fontId", "fillId", "borderId", "xfId"):
                if attr in copied.attrib and attr in maps:
                    value = int(copied.get(attr))
                    if value not in maps[attr]:
                        raise ValueError(f"Undefined extra style {attr}={value}")
                    copied.set(attr, str(maps[attr][value]))
            mapping[i] = len(dest)
            dest.append(copied)
        dest.set("count", str(len(dest)))
        maps[key] = mapping

    dest = child(dst, "cellStyles")
    source = src.find(q("cellStyles"))
    used_names = {e.get("name", "").casefold() for e in dest}
    for element in ([] if source is None else source):
        copied = copy.deepcopy(element)
        copied.set("xfId", str(maps["xfId"][int(copied.get("xfId", "0"))]))
        name = copied.get("name", "Imported")
        if name.casefold() in used_names:
            # Existing original named styles remain authoritative. CellXfs already
            # retain the extra style's direct font/fill/border/alignment values.
            continue
        used_names.add(name.casefold())
        dest.append(copied)
    dest.set("count", str(len(dest)))

    dest = child(dst, "dxfs")
    source = src.find(q("dxfs"))
    mapping = {}
    for i, element in enumerate([] if source is None else source):
        copied = copy.deepcopy(element)
        freeze_colors(copied, palette)
        for num in copied.iter(q("numFmt")):
            old = int(num.get("numFmtId", "0"))
            # In a DXF the format code itself is authoritative. Assign a unique ID
            # even when that ID was not listed in the source's top-level numFmts.
            if old not in num_map:
                num_map[old] = next_num
                next_num += 1
            num.set("numFmtId", str(num_map[old]))
        mapping[i] = len(dest)
        dest.append(copied)
    dest.set("count", str(len(dest)))
    maps["dxfId"] = mapping

    dest = child(dst, "tableStyles")
    source = src.find(q("tableStyles"))
    used_names = {e.get("name", "").casefold() for e in dest}
    custom_table_names = {}
    for element in ([] if source is None else source):
        copied = copy.deepcopy(element)
        name = copied.get("name")
        candidate, suffix = name, 1
        while candidate.casefold() in used_names:
            candidate = name + "_Imported" + str(suffix)
            suffix += 1
        used_names.add(candidate.casefold())
        copied.set("name", candidate)
        custom_table_names[name] = candidate
        remap_dxf(copied, maps["dxfId"])
        dest.append(copied)
    dest.set("count", str(len(dest)))
    if src.find(q("extLst")) is not None:
        raise ValueError("Extra styles contain extension data; merge support is required")
    return serialize(dst, original), maps, custom_table_names


def remap_dxf(root: ET.Element, mapping: dict[int, int]):
    for element in root.iter():
        for attr, value in list(element.attrib.items()):
            if local(attr).lower().endswith("dxfid"):
                element.set(attr, str(mapping[int(value)]))


def next_part(used: set[str], directory: str, stem: str, suffix=".xml") -> str:
    index = 1
    while f"{directory}/{stem}{index}{suffix}" in used:
        index += 1
    result = f"{directory}/{stem}{index}{suffix}"
    used.add(result)
    return result


def copy_content_type(src: ET.Element, dst: ET.Element, old: str, new: str):
    override = next((e for e in src if local(e.tag) == "Override"
                     and e.get("PartName") == "/" + old), None)
    if override is not None:
        e = copy.deepcopy(override)
        e.set("PartName", "/" + new)
        dst.append(e)
        return
    extension = old.rsplit(".", 1)[-1]
    default = next((e for e in src if local(e.tag) == "Default"
                    and e.get("Extension") == extension), None)
    if default is None:
        raise ValueError(f"No content type for {old}")
    existing = next((e for e in dst if local(e.tag) == "Default"
                     and e.get("Extension") == extension), None)
    if existing is None:
        dst.append(copy.deepcopy(default))
    elif existing.get("ContentType") != default.get("ContentType"):
        dst.append(ET.Element(q("Override", CT), {"PartName": "/" + new,
                        "ContentType": default.get("ContentType")}))


def update_app(data: bytes, added_names: list[str]) -> bytes:
    root = parse(data)
    titles = root.find("ep:TitlesOfParts/vt:vector", NS)
    headings = root.find("ep:HeadingPairs/vt:vector", NS)
    if titles is None or headings is None:
        return data
    variants = list(headings)
    insertion_index = 0
    found = False
    for i in range(0, len(variants) - 1, 2):
        label = "".join(variants[i].itertext())
        count = next(iter(variants[i + 1]), None)
        if count is None:
            continue
        old_count = int(count.text or 0)
        insertion_index += old_count
        if label.casefold() in ("worksheets", "工作表"):
            count.text = str(old_count + len(added_names))
            found = True
            break
    if not found:
        return data
    for i, name in enumerate(added_names):
        e = ET.Element(q("lpstr", VT))
        e.text = name
        titles.insert(insertion_index + i, e)
    titles.set("size", str(len(titles)))
    return serialize(root, data)


def merge(original_path: Path, extra_path: Path, output_path: Path,
          omitted_sheet: str | None = None) -> dict:
    if output_path.is_symlink():
        raise FileExistsError("The output path must not be a symbolic link")
    original_path, extra_path, output_path = (p.resolve() for p in
                                               (original_path, extra_path, output_path))
    report_path = output_path.with_suffix(".merge-validation.json")
    if output_path == report_path or any(p in (original_path, extra_path)
                                        for p in (output_path, report_path)):
        raise ValueError("The output path must be different from both input files")
    for destination in (output_path, report_path):
        if destination.exists() or destination.is_symlink():
            raise FileExistsError(f"Output already exists; choose a new output path: {destination}")
    original_hash = digest(original_path.read_bytes())
    extra_hash = digest(extra_path.read_bytes())
    with zipfile.ZipFile(original_path) as z:
        original_infos = z.infolist()
        original_comment = z.comment
        orig = {name: z.read(name) for name in z.namelist()}
    with zipfile.ZipFile(extra_path) as z:
        extra = {name: z.read(name) for name in z.namelist()}
    if len(orig) != len(original_infos):
        raise ValueError("Original ZIP contains duplicate member names")
    if any(n.startswith("_xmlsignatures/") for n in orig):
        raise ValueError("Original workbook has digital signatures; adding sheets invalidates them")
    out = dict(orig)
    owb, osheets = workbook_sheets(orig)
    xwb, xsheets = workbook_sheets(extra)
    if date1904(owb) != date1904(xwb):
        raise ValueError("Original and extra workbook use different Excel date systems")
    original_names = {s["name"].casefold() for s in osheets}
    if omitted_sheet is not None:
        if omitted_sheet not in {s["name"] for s in osheets}:
            raise ValueError("The omitted sheet does not exist in the original workbook")
        if omitted_sheet not in {s["name"] for s in xsheets}:
            raise ValueError("The omitted sheet does not exist in the extra workbook")
    selected = [s for s in xsheets if s["name"] != omitted_sheet]
    if not selected:
        raise ValueError("Extra workbook contains no additional sheets")
    if any(s["name"].casefold() in original_names for s in selected):
        raise ValueError("A new worksheet name conflicts with an original worksheet name")
    if len({s["name"].casefold() for s in selected}) != len(selected):
        raise ValueError("Extra contains duplicate worksheet names")
    for r in relationships(extra, WORKBOOK).values():
        kind = r.get("Type", "").rsplit("/", 1)[-1]
        if kind == "sheetMetadata":
            # Some producers emit unused workbook metadata unconditionally. It
            # is safe to omit only when no imported cell refers to an entry.
            # Referenced cell/value metadata (including dynamic-array metadata)
            # requires explicit index/part remapping, which is not implemented.
            for selected_sheet in selected:
                for cell in parse(extra[selected_sheet["path"]]).iter(q("c")):
                    if "cm" in cell.attrib or "vm" in cell.attrib:
                        raise ValueError("Imported cells reference unsupported workbook metadata")
            continue
        if kind not in ("worksheet", "styles", "theme", "sharedStrings", "calcChain"):
            raise ValueError(f"Unsupported extra workbook dependency: {kind}")

    ostyle_rel = next(r for r in relationships(orig, WORKBOOK).values()
                      if r.get("Type", "").endswith("/styles"))
    xstyle_rel = next(r for r in relationships(extra, WORKBOOK).values()
                      if r.get("Type", "").endswith("/styles"))
    ostyle_path = resolve(WORKBOOK, ostyle_rel.get("Target"))
    xstyle_path = resolve(WORKBOOK, xstyle_rel.get("Target"))
    out[ostyle_path], style_maps, table_style_names = merge_styles(
        orig[ostyle_path], extra[xstyle_path], theme_colors(extra))

    sst_rel = next((r for r in relationships(extra, WORKBOOK).values()
                    if r.get("Type", "").endswith("/sharedStrings")), None)
    sst = list(parse(extra[resolve(WORKBOOK, sst_rel.get("Target"))])) if sst_rel is not None else []
    used_paths = set(orig)
    otypes, xtypes = parse(orig["[Content_Types].xml"]), parse(extra["[Content_Types].xml"])
    new_table_parts = {}
    table_names = {}
    original_tables = [parse(data) for name, data in orig.items()
                       if name.startswith("xl/tables/") and name.endswith(".xml")]
    used_table_names = {t.get(attr, "").casefold() for t in original_tables
                        for attr in ("name", "displayName")}
    next_table_id = max([int(t.get("id", "0")) for t in original_tables] + [0]) + 1
    table_id_map = {}
    sheet_index_map = {}
    for added_index, s in enumerate(selected, start=len(osheets)):
        s["new_path"] = next_part(used_paths, "xl/worksheets", "sheet")
        sheet_index_map[s["index"]] = added_index
        for rel in relationships(extra, s["path"]).values():
            if rel.get("TargetMode") == "External":
                continue
            kind = rel.get("Type", "").rsplit("/", 1)[-1]
            if kind != "table":
                raise ValueError(f"Unsupported new-sheet dependency {kind}: {s['name']}")
            old = resolve(s["path"], rel.get("Target"))
            if old in new_table_parts:
                raise ValueError(f"A table is shared by more than one new sheet: {old}")
            if rels_path(old) in extra:
                raise ValueError(f"New table contains unsupported relationships: {old}")
            new_table_parts[old] = next_part(used_paths, "xl/tables", "table")
            table = parse(extra[old])
            name = table.get("name") or table.get("displayName")
            candidate, suffix = name, 1
            while candidate.casefold() in used_table_names:
                candidate = name + "_Imported" + str(suffix)
                suffix += 1
            used_table_names.add(candidate.casefold())
            for attr in ("name", "displayName"):
                if table.get(attr):
                    table_names[table.get(attr)] = candidate
            table_id_map[old] = next_table_id
            next_table_id += 1

    def rewrite_common(root):
        remap_dxf(root, style_maps["dxfId"])
        for element in root.iter():
            if local(element.tag) in ("f", "formula", "formula1", "formula2",
                                      "calculatedColumnFormula", "totalsRowFormula"):
                element.text = rewrite_formula(element.text, table_names)
            if local(element.tag) == "tableStyleInfo" and element.get("name") in table_style_names:
                element.set("name", table_style_names[element.get("name")])

    for old, new in new_table_parts.items():
        table = parse(extra[old])
        table.set("id", str(table_id_map[old]))
        for attr in ("name", "displayName"):
            if table.get(attr):
                table.set(attr, table_names[table.get(attr)])
        rewrite_common(table)
        out[new] = serialize(table, extra[old])
        copy_content_type(xtypes, otypes, old, new)

    orel_root = parse(orig[WORKBOOK_RELS])
    used_rids = {r.get("Id") for r in orel_root}
    next_sheet_id = max(int(s["element"].get("sheetId")) for s in osheets) + 1
    new_stats = []
    for s in selected:
        sheet = parse(extra[s["path"]])
        for element in sheet.iter():
            tag = local(element.tag)
            style_attr = "style" if tag == "col" else "s" if tag in ("c", "row") else None
            if style_attr and style_attr in element.attrib:
                element.set(style_attr, str(style_maps["s"][int(element.get(style_attr))]))
            elif tag == "c" and 0 in style_maps["s"]:
                # Unstyled extra cells use its style zero, not original style zero.
                element.set("s", str(style_maps["s"][0]))
            if tag == "c" and element.get("t") == "s":
                value = element.find(q("v"))
                index = int(value.text)
                if not 0 <= index < len(sst):
                    raise ValueError(f"Invalid shared-string index {index}")
                inline = copy.deepcopy(sst[index])
                inline.tag = q("is")
                element.remove(value)
                element.set("t", "inlineStr")
                element.append(inline)
        rewrite_common(sheet)
        out[s["new_path"]] = serialize(sheet, extra[s["path"]])
        copy_content_type(xtypes, otypes, s["path"], s["new_path"])
        if rels_path(s["path"]) in extra:
            relroot = parse(extra[rels_path(s["path"])])
            for r in relroot:
                if r.get("TargetMode") != "External":
                    old = resolve(s["path"], r.get("Target"))
                    r.set("Target", relative(s["new_path"], new_table_parts[old]))
            out[rels_path(s["new_path"])] = serialize(relroot, extra[rels_path(s["path"])])
        rid_index = 1
        while "rId" + str(rid_index) in used_rids:
            rid_index += 1
        rid = "rId" + str(rid_index)
        used_rids.add(rid)
        orel_root.append(ET.Element(q("Relationship", REL), {"Id": rid,
            "Type": DOCREL + "/worksheet", "Target": relative(WORKBOOK, s["new_path"])}))
        registration = copy.deepcopy(s["element"])
        registration.set("sheetId", str(next_sheet_id))
        registration.set(q("id", DOCREL), rid)
        owb.find(q("sheets")).append(registration)
        next_sheet_id += 1
        new_stats.append({"name": s["name"], "path": s["new_path"],
                          "cells": sum(1 for _ in sheet.iter(q("c"))),
                          "formulas": sum(1 for _ in sheet.iter(q("f")))})

    names = xwb.find(q("definedNames"))
    if names is not None and len(names):
        dest_names = child(owb, "definedNames", WORKBOOK_ORDER)
        used_names = {(n.get("name", "").casefold(), n.get("localSheetId")): n
                      for n in dest_names}
        for element in names:
            copied = copy.deepcopy(element)
            local_id = copied.get("localSheetId")
            if local_id is not None:
                if int(local_id) not in sheet_index_map:
                    continue
                copied.set("localSheetId", str(sheet_index_map[int(local_id)]))
            copied.text = rewrite_formula(copied.text, table_names)
            key = (copied.get("name", "").casefold(), copied.get("localSheetId"))
            if key in used_names:
                if (used_names[key].text or "") != (copied.text or ""):
                    raise ValueError(f"Conflicting workbook defined name: {copied.get('name')}")
                continue
            dest_names.append(copied)
            used_names[key] = copied

    out[WORKBOOK] = serialize(owb, orig[WORKBOOK])
    out[WORKBOOK_RELS] = serialize(orel_root, orig[WORKBOOK_RELS])
    out["[Content_Types].xml"] = serialize(otypes, orig["[Content_Types].xml"])
    if "docProps/app.xml" in orig:
        out["docProps/app.xml"] = update_app(orig["docProps/app.xml"], [s["name"] for s in selected])
    allowed_changed = {WORKBOOK, WORKBOOK_RELS, "[Content_Types].xml", ostyle_path, "docProps/app.xml"}
    changed = [name for name in orig if orig[name] != out[name]]
    unexpected = [name for name in changed if name not in allowed_changed]
    if unexpected:
        raise AssertionError(f"Original parts unexpectedly changed: {unexpected}")
    # Confirm every written XML and relationship target before touching the output.
    for filename, content in out.items():
        if filename.endswith((".xml", ".rels")):
            root = parse(content)
            if filename.endswith(".rels"):
                owner = "" if filename == "_rels/.rels" else posixpath.join(
                    posixpath.dirname(posixpath.dirname(filename)), posixpath.basename(filename)[:-5])
                for r in root:
                    if r.get("TargetMode") != "External":
                        target = resolve(owner, r.get("Target"))
                        if target not in out:
                            raise ValueError(f"Dangling relationship {filename}: {target}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "x", compression=zipfile.ZIP_DEFLATED) as z:
        z.comment = original_comment
        for info in original_infos:
            z.writestr(info, out[info.filename])
        for name in sorted(set(out) - set(orig)):
            z.writestr(name, out[name])
    with zipfile.ZipFile(output_path) as z:
        corrupted = z.testzip()
        if corrupted:
            raise AssertionError(f"ZIP integrity failure: {corrupted}")
        checked = []
        for filename, content in orig.items():
            if filename not in allowed_changed:
                actual = z.read(filename)
                if actual != content:
                    raise AssertionError(f"Preservation failure: {filename}")
                checked.append({"part": filename, "sha256": digest(content), "byte_identical": True})
        verify_original_styles(orig[ostyle_path], z.read(ostyle_path))
    if digest(original_path.read_bytes()) != original_hash:
        raise AssertionError("Original input changed during processing")
    if digest(extra_path.read_bytes()) != extra_hash:
        raise AssertionError("Extra input changed during processing")
    report = {"original": str(original_path), "extra": str(extra_path), "output": str(output_path),
              "original_sha256": original_hash, "original_input_unchanged": True,
              "extra_sha256": extra_hash, "extra_input_unchanged": True,
              "omitted_extra_sheet": omitted_sheet, "original_sheets": [s["name"] for s in osheets],
              "added_sheets": new_stats, "original_parts_changed": changed,
              "original_parts_preserved_count": len(checked), "original_parts_preserved": checked,
              "original_style_entries_preserved": True,
              "new_table_parts": new_table_parts, "table_name_mapping": table_names,
              "verification": "All original parts outside the explicit registration/style/app allowlist are byte-identical. Original style entries keep their original indices and XML semantics."}
    with report_path.open("x", encoding="utf-8") as report_file:
        report_file.write(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def semantic(element: ET.Element):
    return (element.tag, tuple(sorted(element.attrib.items())), element.text or "",
            tuple(semantic(e) for e in element))


def verify_original_styles(before: bytes, after: bytes):
    src, dst = parse(before), parse(after)
    for collection in STYLE_ORDER:
        source, target = src.find(q(collection)), dst.find(q(collection))
        if source is None:
            continue
        if target is None or len(target) < len(source):
            raise AssertionError(f"Original styles collection lost: {collection}")
        for index, entry in enumerate(source):
            if semantic(entry) != semantic(target[index]):
                raise AssertionError(f"Original style changed: {collection}[{index}]")
        for attr, value in source.attrib.items():
            if attr != "count" and target.get(attr) != value:
                raise AssertionError(f"Original style collection attribute changed: {collection}.{attr}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("original", type=Path)
    parser.add_argument("extra", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--omit-sheet", help="Temporary extra sheet already present in the original; omit only when explicitly requested")
    args = parser.parse_args()
    try:
        report = merge(args.original, args.extra, args.output, args.omit_sheet)
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": "Workbook merge failed; check input compatibility, sheet selection, and unused output destinations"}), file=sys.stderr)
        return 1
    print(json.dumps({"output": report["output"], "added_sheet_count": len(report["added_sheets"]),
          "original_sha256": report["original_sha256"], "extra_sha256": report["extra_sha256"],
          "original_parts_preserved_count": report["original_parts_preserved_count"],
          "original_input_unchanged": True, "extra_input_unchanged": True}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
