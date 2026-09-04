import base64,json,os,sys,cv2,numpy as np
ROOT=os.environ.get('AVATAR_QA_MODEL_ROOT','')
detector=cv2.FaceDetectorYN.create(os.path.join(ROOT,'face_detection_yunet_2023mar.onnx'),'',(320,320),0.85,0.3,5000)
recognizer=cv2.FaceRecognizerSF.create(os.path.join(ROOT,'face_recognition_sface_2021dec.onnx'),'')
def face(value):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(value),np.uint8),cv2.IMREAD_COLOR)
  if image is None:return {'status':'DECODE_FAILED'}
  detector.setInputSize((image.shape[1],image.shape[0]));_,faces=detector.detect(image)
  if faces is None or len(faces)==0:return {'status':'NO_FACE','faceCount':0,'width':image.shape[1],'height':image.shape[0]}
  detected=list(faces); confident=[item for item in detected if item[-1]>=0.85]
  usable=[item for item in confident if item[2]>=32 and item[3]>=32]
  if len(usable)>1:return {'status':'MULTIPLE_FACES','faceCount':len(usable),'width':image.shape[1],'height':image.shape[0]}
  if len(confident)==0:return {'status':'FACE_LOW_CONFIDENCE','faceCount':len(detected),'width':image.shape[1],'height':image.shape[0],'confidence':float(max(item[-1] for item in detected))}
  if len(usable)==0:return {'status':'FACE_TOO_SMALL','faceCount':len(confident),'width':image.shape[1],'height':image.shape[0],'confidence':float(max(item[-1] for item in confident))}
  item=usable[0];aligned=recognizer.alignCrop(image,item);feature=recognizer.feature(aligned)
  box=[float(x) for x in item[:4]];landmarks=[float(x) for x in item[4:14]]
  return {'status':'ONE_USABLE_FACE','faceCount':1,'feature':feature,'box':box,'landmarks':landmarks,'confidence':float(item[-1]),'width':image.shape[1],'height':image.shape[0]}
def evaluate(req):
  candidate=face(req['candidate']);out={'candidateStatus':candidate['status'],'observations':[]}
  if candidate['status']!='ONE_USABLE_FACE':return out
  out['candidateGeometry']={'box':candidate['box'],'landmarks':candidate['landmarks'],'width':candidate['width'],'height':candidate['height']}
  for source in req['sources']:
    item=face(source['bytes']);row={'sourceHash':source['contentHash'],'sourceStatus':item['status']}
    if item['status']=='ONE_USABLE_FACE':
      row['cosine']=float(recognizer.match(candidate['feature'],item['feature'],cv2.FaceRecognizerSF_FR_COSINE));row['sourceGeometry']={'box':item['box'],'landmarks':item['landmarks'],'width':item['width'],'height':item['height']}
    out['observations'].append(row)
  return out
def scan(req):
  items=[]
  for source in req['sources']:
    detected=face(source['bytes']);items.append({'intakeId':source['intakeId'],'contentHash':source['contentHash'],'status':detected['status'],'faceCount':detected.get('faceCount'),'box':detected.get('box'),'landmarks':detected.get('landmarks'),'width':detected.get('width'),'height':detected.get('height'),'confidence':detected.get('confidence'),'feature':detected.get('feature')})
  pairs=[]
  for left in range(len(items)):
    for right in range(left+1,len(items)):
      if items[left]['status']=='ONE_USABLE_FACE' and items[right]['status']=='ONE_USABLE_FACE':pairs.append({'left':items[left]['contentHash'],'right':items[right]['contentHash'],'cosine':float(recognizer.match(items[left]['feature'],items[right]['feature'],cv2.FaceRecognizerSF_FR_COSINE))})
  for item in items:item.pop('feature',None)
  return {'items':items,'pairs':pairs}
def video(req):
  sources=[face(source['bytes']) for source in req['sources']]
  frames=[];previous=None
  for frame in req['frames']:
    detected=face(frame['bytes']);row={'frameIndex':frame['frameIndex'],'candidateStatus':detected['status'],'geometry':{'box':detected.get('box'),'landmarks':detected.get('landmarks'),'width':detected.get('width'),'height':detected.get('height')},'observations':[]}
    if detected['status']=='ONE_USABLE_FACE':
      for index,source in enumerate(sources):
        source_hash=req['sources'][index]['contentHash'];observation={'sourceHash':source_hash,'sourceStatus':source['status']}
        if source['status']=='ONE_USABLE_FACE':observation['cosine']=float(recognizer.match(detected['feature'],source['feature'],cv2.FaceRecognizerSF_FR_COSINE))
        row['observations'].append(observation)
      if previous is not None:row['adjacentCosine']=float(recognizer.match(previous,detected['feature'],cv2.FaceRecognizerSF_FR_COSINE))
      previous=detected['feature']
    else:previous=None
    frames.append(row)
  return {'frames':frames}
for line in sys.stdin:
  try:
    req=json.loads(line);operation=req.get('operation');result=scan(req) if operation=='scan' else video(req) if operation=='video' else evaluate(req);print(json.dumps({'id':req['id'],'ok':True,'result':result}),flush=True)
  except Exception as error:print(json.dumps({'id':req.get('id'),'ok':False,'error':'LOCAL_EVALUATOR_ERROR'}),flush=True)
