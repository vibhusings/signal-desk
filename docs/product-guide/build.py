from pathlib import Path
import json, shutil
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
root=Path(__file__).resolve().parents[2]
data=json.loads((root/'docs/product-guide/content.json').read_text())
assets=root/'ui/public/guide-assets';assets.mkdir(exist_ok=True,parents=True)
font='/System/Library/Fonts/Supplemental/Arial.ttf';bold='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
def diagram(name, nodes, links, subtitle):
 height=620 if name=='architecture' else 380
 im=Image.new('RGB',(1600,height),'#f4f7fc');d=ImageDraw.Draw(im)
 for a,b in links:
  x,y,w,h,*_=nodes[a];xx,yy,ww,hh,*_=nodes[b]
  start=(x+w,y+h/2);end=(xx,yy+hh/2)
  if yy>y+160:start=(x+w/2,y+h);end=(xx+ww/2,yy)
  d.line([start,end],fill='#6082b3',width=4)
  ex,ey=end
  if yy>y+160:d.polygon([(ex,ey),(ex-8,ey-14),(ex+8,ey-14)],fill='#6082b3')
  else:d.polygon([(ex,ey),(ex-14,ey-8),(ex-14,ey+8)],fill='#6082b3')
 for x,y,w,h,title,body in nodes:
  d.rounded_rectangle((x,y,x+w,y+h),radius=16,fill='white',outline='#aabedb',width=2)
  d.text((x+24,y+22),title,font=ImageFont.truetype(bold,29),fill='#142c4e')
  lines=[]
  bodyfont=ImageFont.truetype(font,23)
  for part in body.split('|'):
   line=''
   for word in part.split():
    candidate=(line+' '+word).strip()
    if d.textlength(candidate,font=bodyfont)>w-48 and line:lines.append(line);line=word
    else:line=candidate
   lines.append(line)
  for i,line in enumerate(lines):d.text((x+24,y+69+27*i),line,font=bodyfont,fill='#42536a')
 d.text((45,height-45),subtitle,font=ImageFont.truetype(font,23),fill='#42536a')
 im.save(assets/(name+'.png'))
diagram('architecture',[(45,40,400,175,'Signal Desk UI','Criteria and settings|Review and approved actions'),(590,40,400,175,'Cloud worker','Claude research and extraction|Scheduled background jobs'),(1145,40,410,175,'Connected providers','Slashy tools and calendar|Optional Crustdata discovery'),(45,340,400,175,'Signal Desk database','Sources and extracted facts|Research and activity history'),(590,340,400,175,'Attio CRM','Configured record destination|Weekly or manual export'),(1145,340,410,175,'User review','Read evidence and status|Resolve exceptions')],[(0,1),(1,2),(0,3),(3,4),(4,5)],'Your browser can close. Background jobs depend on the cloud worker and connected accounts.')
diagram('outreach',[(45,100,330,180,'Discover','Inspect a signal|Find company contacts'),(435,100,330,180,'Review','Check recipients and purpose|Confirm campaign launch'),(825,100,330,180,'Send and follow up','Configured email sequence|Monitor campaign state'),(1215,100,340,180,'Respond','Reply stops ordinary follow-ups|Scheduling checks apply')],[(0,1),(1,2),(2,3)],'Pause a campaign or halt sending when needed. An action already in flight may finish.')
diagram('crm-flow',[(45,80,330,190,'Collect','Inbox messages|Notes or delivered transcripts'),(435,80,330,190,'Extract','Claude identifies facts|Keep supporting quotations'),(825,80,330,190,'Store and review','Signal Desk CRM|Relationships and history'),(1215,80,340,190,'Sync to Attio','Manual or every seven days|Stable IDs update records')],[(0,1),(1,2),(2,3)],'Checking the inbox, extracting facts and exporting to Attio are distinct jobs.')
d=Document();sec=d.sections[0];sec.top_margin=Inches(.65);sec.bottom_margin=Inches(.65);sec.left_margin=Inches(.72);sec.right_margin=Inches(.72)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Caption']:
 st=d.styles[name];st.font.name='Calibri';st.font.color.rgb=RGBColor(0,0,0)
 pp=st.element.find(qn('w:pPr'))
 if pp is not None:
  for border in list(pp.findall(qn('w:pBdr'))):pp.remove(border)
d.styles['Normal'].font.size=Pt(10.5);d.styles['Normal'].paragraph_format.space_after=Pt(7);d.styles['Normal'].paragraph_format.line_spacing=1.08
d.styles['Title'].font.size=Pt(29);d.styles['Heading 1'].font.size=Pt(22);d.styles['Heading 2'].font.size=Pt(13)
d.styles['Heading 2'].paragraph_format.space_before=Pt(10);d.styles['Caption'].font.size=Pt(9);d.styles['Caption'].font.bold=False
footer=sec.footer.paragraphs[0];footer.alignment=2
footer.add_run('Signal Desk  •  ')
f=OxmlElement('w:fldSimple');f.set(qn('w:instr'),'PAGE');footer._p.append(f)
for i,s in enumerate(data['sections']):
 q=d.add_paragraph('PRODUCT HANDBOOK  /  '+str(i+1).zfill(2),style='Subtitle')
 q.paragraph_format.page_break_before=bool(i)
 if i==0:
  d.add_paragraph(data['title'],style='Title');d.add_paragraph(data['date']+'  |  Pilot edition')
 else:d.add_paragraph(s['title'],style='Heading 1')
 para=d.add_paragraph(s['lead']);para.runs[0].bold=True
 for b in s['blocks']:
  t=b['type']
  if t in ['p','h']:d.add_paragraph(b['text'],style='Heading 2' if t=='h' else 'Normal')
  elif t in ['steps','bullets']:
   for j,item in enumerate(b['items']):
    q=d.add_paragraph((str(j+1)+'. ' if t=='steps' else '• ')+item);q.paragraph_format.space_after=Pt(5)
  elif t=='figure':
   d.add_picture(str(assets/(b['name']+'.png')),width=Inches(6.95));d.add_paragraph(b['caption'],style='Caption')
  elif t=='table':
   tb=d.add_table(rows=1,cols=len(b['headers']));tb.alignment=WD_TABLE_ALIGNMENT.CENTER;tb.autofit=False
   widths=[2.05,4.9]
   for column,width in zip(tb.columns,widths):column.width=Inches(width)
   for row_idx,row in enumerate([b['headers']]+b['rows']):
    cells=tb.rows[0].cells if row_idx==0 else tb.add_row().cells
    for k,txt in enumerate(row):
     cell=cells[k];cell.width=Inches(widths[k]);cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
     cell.text=txt
     pr=cell._tc.get_or_add_tcPr();shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'183A60' if row_idx==0 else 'F1F5FA' if row_idx%2 else 'FFFFFF');pr.append(shade)
     borders=OxmlElement('w:tcBorders')
     for edge in ['top','left','bottom','right']:
      e=OxmlElement('w:'+edge);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');borders.append(e)
     pr.append(borders);marg=OxmlElement('w:tcMar')
     for edge in ['top','left','bottom','right']:
      e=OxmlElement('w:'+edge);e.set(qn('w:w'),'90');e.set(qn('w:type'),'dxa');marg.append(e)
     pr.append(marg)
     for par in cell.paragraphs:
      par.paragraph_format.space_after=Pt(0);par.paragraph_format.line_spacing=1.05
      for run in par.runs:run.font.size=Pt(9.5);run.bold=row_idx==0;run.font.color.rgb=RGBColor.from_string('FFFFFF' if row_idx==0 else '172334')
    trpr=tb.rows[row_idx]._tr.get_or_add_trPr();trpr.append(OxmlElement('w:cantSplit'))
    if row_idx==0:trpr.append(OxmlElement('w:tblHeader'))
   d.add_paragraph('').paragraph_format.space_after=Pt(1)
d.core_properties.title=data['title'];d.core_properties.subject='Features workflows setup and operating guide';d.core_properties.author='Signal Desk';d.core_properties.comments=''
out=root/'docs/exports/Signal-Desk-Product-Handbook.docx';d.save(out);shutil.copy2(out,assets/out.name)
shutil.copy2(root/'docs/product-guide/content.json',root/'ui/app/guide/content.json')
print(out)
