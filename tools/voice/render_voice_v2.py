# Render Deep Sphere v2 voice lines: edge-tts Michelle, rate/pitch matched to the 2026-10-02 set,
# then soft lowpass + short stereo room + level match. Never overwrites an existing file.
import asyncio, io, os, sys, json, numpy as np, soundfile as sf, edge_tts
from scipy.signal import resample_poly, butter, sosfilt, fftconvolve
V='en-US-MichelleNeural'; RATE='-17%'; PITCH='+20Hz'
OUT=sys.argv[1]; MODE=sys.argv[2] if len(sys.argv)>2 else 'final'
LINES={'vo_zone_deep_v2':'Below 1,976 metres. Floodlights on.',
 'vo_max_depth_v2':'Maximum depth: 3,040 metres. The descent ends here.',
 'vo_gate_hint':'The floor is close. Turn the sphere to find the opening.',
 'vo_gate_found':'Opening found. Hold dive to pass through.',
 'vo_gate_pass':'Through the opening. Welcome to the next level.'}
if MODE=='check': LINES={'check_vo_zone_deep_oldtext':'Below 1,976 metres. The only light down here is made by living things. Floodlights on.'}
SR=44100; rng=np.random.default_rng(7)
def ir(rt=1.3,n=SR*16//10):
    t=np.arange(n)/SR; env=np.exp(-6.91*t/rt); ir=rng.standard_normal((n,2))*env[:,None]
    ir[:int(0.012*SR)]=0; return ir/np.sqrt((ir**2).sum(0))
IR=ir()
async def syn(t):
    c=edge_tts.Communicate(t,V,rate=RATE,pitch=PITCH); b=b''
    async for ch in c.stream():
        if ch['type']=='audio': b+=ch['data']
    x,sr=sf.read(io.BytesIO(b)); x=x if x.ndim==1 else x.mean(1)
    return resample_poly(x,SR,sr) if sr!=SR else x
def post(x):
    e=np.abs(x); idx=np.where(e>e.max()*0.02)[0]; x=x[max(0,idx[0]-int(0.02*SR)):idx[-1]+int(0.05*SR)]
    x=sosfilt(butter(1,11000,'low',fs=SR,output='sos'),x)
    dry=np.stack([x,x],1); wet=np.stack([fftconvolve(x,IR[:,0]),fftconvolve(x,IR[:,1])],1)[:len(x)+len(IR)-1]
    y=np.zeros_like(wet); y[:len(dry)]+=dry; y+=0.38*wet
    y=np.concatenate([np.zeros((int(0.16*SR),2)),y])
    seg=y[int(0.16*SR):int(0.16*SR)+len(x)]; g=10**((-21.6-20*np.log10(np.sqrt((seg**2).mean())))/20); y*=g
    pk=np.abs(y).max(); lim=10**(-7.9/20)
    if pk>lim: y*=lim/pk
    k=np.where(np.abs(y).max(1)>10**(-90/20))[0][-1]; return y[:k+1]
async def main():
    os.makedirs(OUT,exist_ok=True); rep={}
    for k,t in LINES.items():
        p=os.path.join(OUT,k+'_en.wav')
        if os.path.exists(p): print('EXISTS, skip',p); continue
        y=post(await syn(t)); sf.write(p,y,SR,subtype='PCM_16'); rep[k]={'text':t,'sec':round(len(y)/SR,2)}
        print(k,rep[k])
    json.dump({'voice':V,'rate':RATE,'pitch':PITCH,'post':'lowpass 1st-order 11k, stereo room RT1.3 wet0.38, speech RMS -21.6 dBFS, peak<=-7.9','lines':rep},open(os.path.join(OUT,'render-'+MODE+'.json'),'w'),indent=1)
asyncio.run(main())
