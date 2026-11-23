const form=document.querySelector('form');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  form.querySelector('button').disabled=true;
  try {
    const input=Object.fromEntries(new FormData(form));
    const response=await fetch('./api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    if(!response.ok) throw new Error(response.status===429?'Too many attempts. Try again later.':'Sign-in failed. Check your team username and password.');
    location.replace('./console.html');
  } catch(error) { form.querySelector('output').textContent=error.message; }
  finally { form.querySelector('button').disabled=false; }
});
