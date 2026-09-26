import gzip
import os
import re
from lxml import etree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
xml_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.xml.gz")
dtd_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.dtd")

WATCH_START = 600000
WATCH_END = 700000


def load_entity_map(dtd_path):
    dtd = etree.DTD(dtd_path)
    return {entity.name: entity.content for entity in dtd.entities()}


ENTITY_MAP = load_entity_map(dtd_file_path)
ENTITY_PATTERN = re.compile(r'&(\w+);')


def substitute_entities(line):
    return ENTITY_PATTERN.sub(
        lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), line
    )


def depth(elem):
    d = 0
    p = elem.getparent()
    while p is not None:
        d += 1
        p = p.getparent()
    return d


parser = etree.XMLPullParser(events=('end',), recover=True)
line_no = 0
target_found = 0

with gzip.open(xml_file_path, 'rt', encoding='iso-8859-1') as f:
    for line in f:
        line_no += 1
        parser.feed(substitute_entities(line))

        for event, elem in parser.read_events():
            if elem.tag in ('article', 'inproceedings'):
                target_found += 1

            if WATCH_START <= line_no <= WATCH_END:
                parent_tag = elem.getparent().tag if elem.getparent() is not None else None
                key = elem.get('key')
                d = depth(elem)
                # only print top-level-ish or unusually deep events to keep output readable
                if d <= 2 or d >= 6:
                    print(f"[line {line_no}] end tag={elem.tag!r} depth={d} "
                          f"parent={parent_tag!r} key={key!r}")

        if line_no > WATCH_END:
            break

print(f"\nDone. target_found so far: {target_found}")
