from fise.profile_runtime import Profile

_U=4294967295

def _m(b,q):
 a,c,d,e=930224244,1525448492,2475370998,1591964988
 for i,x in enumerate(b):
  a=((a^(x+i))*637423025)&_U
  c=((c+x+(a>>16))*1084669627)&_U
  y=(d^x^c)&_U
  d=((y<<20)|(y>>12))&_U
  e=((e+d+i)*3462910935)&_U
 return a,c,d,e

def _o(i,c,s,q):
 f=4103990940
 for n,v in enumerate(s):f=((f^v^n)*0x45d9f3b)&_U
 x=((i.transformed_length^4103990940)+(i.operation_binding_length*771559116)+(c[0]^3489407622)+(c[2]*948156153)+f)&_U
 x^=x>>16
 x=(x*0x7feb352d)&_U
 x^=x>>15
 x=(x*0x846ca68b)&_U
 return (x^(x>>16))%(i.transformed_length+1)

def _k(i,c,s,q):
 x=((i.transformed_length^3655523560)+(i.operation_binding_length*2716856301)+(c[1]^1743843670)+(c[3]*1073053057)+len(s))&_U
 for n,v in enumerate(s):x=((x^v^n)*0x1000193)&_U
 x^=x>>16
 x=(x*0x7feb352d)&_U
 x^=x>>15
 x=(x*0x846ca68b)&_U
 return (x^(x>>16))&_U

def _f(b,s,c,z,q):
 o=bytearray(len(b))
 for i,v in enumerate(b):
  p=(z+i)&_U
  x=v
  w=((p^c[0])*2893853437+c[2]+2498660355)&_U
  k=(s[(p+8)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x*123+k)&255
  w=((p^c[1])*678525073+c[0]+2345904242)&_U
  k=(s[(p+6)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[2])*1287012865+c[1]+439134979)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x<<r)|(x>>(8-r)))&255
  w=((p^c[0])*1218923255+c[1]+3006878621)&_U
  k=(s[(p+4)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[3])*2374299191+c[0]+2379718208)&_U
  k=(s[(p+12)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x+k)&255
  w=((p^c[0])*3299222191+c[0]+1802172735)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x*9+k)&255
  w=((p^c[0])*2363990393+c[3]+834719364)&_U
  k=(s[(p+10)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  o[i]=x
 return bytes(o)

def _r(b,s,c,z,q):
 o=bytearray(len(b))
 for i,v in enumerate(b):
  p=(z+i)&_U
  x=v
  w=((p^c[0])*2363990393+c[3]+834719364)&_U
  k=(s[(p+10)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[0])*3299222191+c[0]+1802172735)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=((x-k)*57)&255
  w=((p^c[3])*2374299191+c[0]+2379718208)&_U
  k=(s[(p+12)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x-k)&255
  w=((p^c[0])*1218923255+c[1]+3006878621)&_U
  k=(s[(p+4)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[2])*1287012865+c[1]+439134979)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x>>r)|(x<<(8-r)))&255
  w=((p^c[1])*678525073+c[0]+2345904242)&_U
  k=(s[(p+6)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[0])*2893853437+c[2]+2498660355)&_U
  k=(s[(p+8)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=((x-k)*179)&255
  o[i]=x
 return bytes(o)

profile=Profile.generated("bbf3dbb44bd7c7d78777acbd12de56da",2849084228,14,_m,_o,_k,_f,_r)
__all__=("profile",)
